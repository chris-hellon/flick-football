using System.Text.Json;
using FlickFootball.Server.Online;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR.Client;

namespace FlickFootball.Server.Tests;

/// <summary>Two real SignalR clients through the test server.</summary>
public sealed class MatchHubTests : IClassFixture<MatchHubTests.Factory>
{
    private static readonly ClubDto Club = new("Baize Rovers", "", "#6b2fa3", "#f2c230", "#5a2690", "stripes");
    private readonly Factory _factory;

    public MatchHubTests(Factory factory) => _factory = factory;

    private async Task<HubConnection> Connect()
    {
        var conn = new HubConnectionBuilder()
            .WithUrl(new Uri(_factory.Server.BaseAddress, "hubs/match"), o =>
            {
                o.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                o.Transports = HttpTransportType.LongPolling;
            })
            .Build();
        await conn.StartAsync();
        return conn;
    }

    [Fact]
    public async Task Host_and_guest_exchange_join_state_and_flick()
    {
        await using var host = await Connect();
        await using var guest = await Connect();
        var joined = new TaskCompletionSource<ClubDto>();
        var flicked = new TaskCompletionSource<FlickDto>();
        var state = new TaskCompletionSource<JsonElement>();
        host.On<ClubDto, string>("GuestJoined", (c, _) => joined.TrySetResult(c));
        host.On<FlickDto>("Flick", f => flicked.TrySetResult(f));
        guest.On<JsonElement>("State", s => state.TrySetResult(s));

        var created = await host.InvokeAsync<CreateResult>("CreateMatch", Club, "4-4-2");
        Assert.True(created.Ok);
        var join = await guest.InvokeAsync<JoinResult>("JoinMatch", created.Code, Club with { Name = "Friends FC" }, "4-3-3", null);
        Assert.Equal("guest", join.Seat);
        Assert.Equal("Friends FC", (await joined.Task.WaitAsync(TimeSpan.FromSeconds(10))).Name);

        var snapshot = JsonDocument.Parse(JsonSerializer.Serialize(new { ph = "aim", tn = 1, lk = (int?)null, p = new int[46], st = "Friends FC to flick." })).RootElement;
        Assert.True(await host.InvokeAsync<bool>("PublishState", snapshot));
        Assert.Equal("Friends FC to flick.", (await state.Task.WaitAsync(TimeSpan.FromSeconds(10))).GetProperty("st").GetString());

        Assert.True(await guest.InvokeAsync<bool>("SendFlick", new FlickDto(1, 15, 0, -800, 0)));
        var f = await flicked.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal(15, f.Id);
        Assert.Equal(-800, f.Vy);
    }

    [Fact]
    public async Task Leaving_as_host_closes_the_room_for_the_guest()
    {
        await using var host = await Connect();
        await using var guest = await Connect();
        var closed = new TaskCompletionSource<string>();
        guest.On<string>("RoomClosed", r => closed.TrySetResult(r));

        var created = await host.InvokeAsync<CreateResult>("CreateMatch", Club, "4-4-2");
        await guest.InvokeAsync<JoinResult>("JoinMatch", created.Code, Club, "4-4-2", null);
        await host.InvokeAsync("Leave");

        Assert.Equal("host-left", await closed.Task.WaitAsync(TimeSpan.FromSeconds(10)));
    }

    [Fact]
    public async Task Too_many_connection_attempts_from_one_address_are_refused()
    {
        // Its own server, so it doesn't use up the shared one's allowance.
        using var factory = new Factory();
        using var client = factory.CreateClient();
        var codes = new List<int>();
        for (var i = 0; i < 40; i++)
            codes.Add((int)(await client.PostAsync("/hubs/match/negotiate?negotiateVersion=1", null)).StatusCode);

        Assert.Contains(429, codes);
        // Ordinary page requests are never throttled.
        Assert.Equal(200, (int)(await client.GetAsync("/")).StatusCode);
    }

    public sealed class Factory : WebApplicationFactory<Program>
    {
        private readonly string _webRoot = Directory.CreateTempSubdirectory("ff-hub-").FullName;

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            File.WriteAllText(Path.Combine(_webRoot, "index.html"), "<!doctype html>");
            builder.UseEnvironment("Testing").UseWebRoot(_webRoot);
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            if (disposing && Directory.Exists(_webRoot)) Directory.Delete(_webRoot, recursive: true);
        }
    }
}
