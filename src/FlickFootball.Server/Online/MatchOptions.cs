namespace FlickFootball.Server.Online;

/// <summary>Limits that keep online play light on a shared droplet. Bound from the "Match" config section.</summary>
public sealed class MatchOptions
{
    public const string Section = "Match";

    public int MaxRooms { get; set; } = 500;
    public int MaxConnections { get; set; } = 2000;
    public int MaxRoomsPerIp { get; set; } = 10;
    public int MaxSpectators { get; set; } = 8;

    /// <summary>Largest state snapshot relayed, in bytes of JSON. Bigger ones are dropped.</summary>
    public int MaxStateBytes { get; set; } = 8 * 1024;

    /// <summary>SignalR's own cap on one incoming message (snapshot plus envelope).</summary>
    public int MaxReceiveMessageBytes { get; set; } = 10 * 1024;

    public int HostMessagesPerSecond { get; set; } = 20;
    public int OtherMessagesPerSecond { get; set; } = 15;

    /// <summary>How long a room waits for its host to come back.</summary>
    public TimeSpan HostGrace { get; set; } = TimeSpan.FromMinutes(2);

    /// <summary>How long a dropped guest's seat is held for their rejoin token.</summary>
    public TimeSpan SeatGrace { get; set; } = TimeSpan.FromMinutes(2);

    public TimeSpan RoomLifetime { get; set; } = TimeSpan.FromHours(3);

    /// <summary>Hub connection attempts (negotiate requests) per IP per minute.</summary>
    public int NegotiationsPerMinute { get; set; } = 30;
}
