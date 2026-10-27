using Microsoft.AspNetCore.SignalR;

namespace FlickFootball.Server.Online;

/// <summary>Every 30 seconds, closes rooms whose host has gone or that have run their course.</summary>
public sealed class RoomExpiryService(RoomRegistry rooms, IHubContext<MatchHub> hub, TimeProvider time, ILogger<RoomExpiryService> log)
    : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval, time);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await MatchHub.SendNotices(hub.Clients, rooms.Expire());
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Room expiry pass failed");
            }
        }
    }
}
