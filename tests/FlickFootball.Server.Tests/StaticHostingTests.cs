using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace FlickFootball.Server.Tests;

// wwwroot is build output (not committed), so each test run serves a small fake client build.
public sealed class StaticHostingTests : IClassFixture<StaticHostingTests.Factory>
{
    private readonly HttpClient _client;

    public StaticHostingTests(Factory factory) => _client = factory.CreateClient();

    [Fact]
    public async Task Root_serves_index_html()
    {
        var response = await _client.GetAsync("/");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/html", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains(Factory.Marker, await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Unknown_path_falls_back_to_index_html()
    {
        var response = await _client.GetAsync("/m/ABCDE");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains(Factory.Marker, await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Static_asset_is_served()
    {
        var response = await _client.GetAsync("/assets/app.js");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/javascript", response.Content.Headers.ContentType?.MediaType);
    }

    [Theory]
    [InlineData("/")]
    [InlineData("/index.html")]
    [InlineData("/m/ABCDE")]
    public async Task The_page_is_revalidated_on_every_visit(string path)
    {
        var response = await _client.GetAsync(path);

        Assert.Equal(CacheHeaders.Revalidate, response.Headers.CacheControl?.ToString());
    }

    [Fact]
    public async Task Hashed_assets_are_cached_for_good()
    {
        var response = await _client.GetAsync("/assets/app.js");

        Assert.Equal(CacheHeaders.Forever, response.Headers.CacheControl?.ToString());
    }

    [Fact]
    public async Task Health_check_answers_ok()
    {
        var response = await _client.GetAsync("/healthz");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("ok", await response.Content.ReadAsStringAsync());
    }

    public sealed class Factory : WebApplicationFactory<Program>
    {
        public const string Marker = "flick-football-test-shell";

        private readonly string _webRoot =
            Directory.CreateTempSubdirectory("ff-wwwroot-").FullName;

        public Factory()
        {
            File.WriteAllText(Path.Combine(_webRoot, "index.html"),
                $"<!doctype html><title>{Marker}</title>");
            Directory.CreateDirectory(Path.Combine(_webRoot, "assets"));
            File.WriteAllText(Path.Combine(_webRoot, "assets", "app.js"), "export {};");
        }

        // Not Development: that environment maps the project's real wwwroot via static web assets.
        protected override void ConfigureWebHost(IWebHostBuilder builder) =>
            builder.UseEnvironment("Testing").UseWebRoot(_webRoot);

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            if (disposing && Directory.Exists(_webRoot)) Directory.Delete(_webRoot, recursive: true);
        }
    }
}
