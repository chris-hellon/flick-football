using System.Threading.RateLimiting;
using FlickFootball.Server;
using FlickFootball.Server.Online;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<MatchOptions>(builder.Configuration.GetSection(MatchOptions.Section));
var match = builder.Configuration.GetSection(MatchOptions.Section).Get<MatchOptions>() ?? new MatchOptions();

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<RoomRegistry>();
builder.Services.AddSingleton<MessageRateLimiter>();
builder.Services.AddHostedService<RoomExpiryService>();
builder.Services.AddSignalR(o => o.MaximumReceiveMessageSize = match.MaxReceiveMessageBytes);

// Nginx sits in front in production: trust its X-Forwarded-* headers (loopback proxies only, the default).
builder.Services.Configure<ForwardedHeadersOptions>(o =>
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto);

// Limit new hub connections per IP. Only negotiate requests count: long polling makes a request
// per poll, and those must not be throttled.
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
        ctx.Request.Path.StartsWithSegments("/hubs/match/negotiate")
            ? RateLimitPartition.GetFixedWindowLimiter(
                ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = ctx.RequestServices.GetRequiredService<IOptions<MatchOptions>>().Value.NegotiationsPerMinute,
                    Window = TimeSpan.FromMinutes(1),
                })
            : RateLimitPartition.GetNoLimiter("other"));
});

var app = builder.Build();

app.UseForwardedHeaders();
app.UseRateLimiter();

// The Vite build lands in wwwroot; any unknown path (e.g. /m/ABCDE) gets the app shell.
// Vite names its assets by content hash, so they can be cached for good; the page itself must be
// checked every time so a new deploy shows up at once.
var staticFiles = new StaticFileOptions { OnPrepareResponse = ctx => CacheHeaders.Apply(ctx.Context) };
app.UseDefaultFiles();
app.UseStaticFiles(staticFiles);

app.MapGet("/healthz", () => Results.Text("ok")).ShortCircuit();
app.MapHub<MatchHub>("/hubs/match");
app.MapFallbackToFile("index.html", staticFiles);

app.Run();

public partial class Program;
