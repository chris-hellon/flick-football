using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;

namespace FlickFootball.Server.Online;

/// <summary>
/// Relays a host-authoritative match: the host's browser simulates and publishes snapshots, the
/// guest sends flicks, aims and skips. See docs/ONLINE_PROTOCOL.md.
/// </summary>
public sealed class MatchHub(RoomRegistry rooms, MessageRateLimiter limiter, IOptions<MatchOptions> options) : Hub
{
    private readonly MatchOptions _o = options.Value;

    public override async Task OnConnectedAsync()
    {
        if (!rooms.TryConnect())
        {
            Context.Items["rejected"] = true;
            Context.Abort();
            return;
        }
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        limiter.Forget(Context.ConnectionId);
        if (!Context.Items.ContainsKey("rejected")) await Send(rooms.Disconnected(Context.ConnectionId));
        await base.OnDisconnectedAsync(exception);
    }

    public async Task<CreateResult> CreateMatch(ClubDto? club, string? form)
    {
        if (!Allowed(_o.OtherMessagesPerSecond)) return new CreateResult(false, "Slow down a moment.", null, null, null);
        var (result, notices) = rooms.Create(Context.ConnectionId, ClientIp(), club, form);
        await Send(notices);
        return result;
    }

    public async Task<JoinResult> JoinMatch(string? code, ClubDto? club, string? form, string? token)
    {
        if (!Allowed(_o.OtherMessagesPerSecond))
            return new JoinResult(false, "Slow down a moment.", null, null, null, null, null, false, null);
        var (result, notices) = rooms.Join(Context.ConnectionId, code, club, form, token);
        await Send(notices);
        return result;
    }

    public async Task UpdateClub(ClubDto? club, string? form)
    {
        if (Allowed(_o.OtherMessagesPerSecond)) await Send(rooms.UpdateClub(Context.ConnectionId, club, form));
    }

    public async Task<bool> PublishState(JsonElement state)
    {
        if (!Allowed(_o.HostMessagesPerSecond)) return false;
        var (ok, notices) = rooms.Publish(Context.ConnectionId, state);
        await Send(notices);
        return ok;
    }

    public async Task<bool> SendFlick(FlickDto? flick)
    {
        if (!Allowed(_o.OtherMessagesPerSecond)) return false;
        var (ok, notices) = rooms.Flick(Context.ConnectionId, flick);
        await Send(notices);
        return ok;
    }

    public async Task SendAim(AimDto? aim)
    {
        if (Allowed(_o.OtherMessagesPerSecond)) await Send(rooms.Aim(Context.ConnectionId, aim));
    }

    public async Task<bool> SendSkip(long n)
    {
        if (!Allowed(_o.OtherMessagesPerSecond)) return false;
        var (ok, notices) = rooms.Skip(Context.ConnectionId, n);
        await Send(notices);
        return ok;
    }

    public async Task Leave() => await Send(rooms.Leave(Context.ConnectionId));

    private bool Allowed(int perSecond)
    {
        switch (limiter.Check(Context.ConnectionId, perSecond))
        {
            case RateVerdict.Allow:
                return true;
            case RateVerdict.Abuse:
                Context.Abort();
                return false;
            default:
                return false;
        }
    }

    private string ClientIp() => Context.GetHttpContext()?.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    private Task Send(IReadOnlyList<Notice> notices) => SendNotices(Clients, notices);

    internal static async Task SendNotices(IHubClients<IClientProxy> clients, IReadOnlyList<Notice> notices)
    {
        foreach (var n in notices)
        {
            if (n.To.Count > 0) await clients.Clients(n.To).SendCoreAsync(n.Method, n.Args);
        }
    }
}
