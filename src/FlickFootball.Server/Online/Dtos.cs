using System.Text.Json;

namespace FlickFootball.Server.Online;

/// <summary>A club's look as players share it. Everything in it is untrusted until cleaned.</summary>
public sealed record ClubDto(string? Name, string? Code, string? Shirt, string? Alt, string? Base, string? Pat);

/// <summary>A guest's flick: sequence number, player id, velocity, block flick flag.</summary>
public sealed record FlickDto(long N, int Id, double Vx, double Vy, int B);

/// <summary>An aim preview while a player drags.</summary>
public sealed record AimDto(int Id, double Vx, double Vy, int B);

public sealed record CreateResult(bool Ok, string? Error, string? Code, string? Seat, string? Token);

public sealed record JoinResult(
    bool Ok,
    string? Error,
    string? Code,
    string? Seat,
    string? Token,
    ClubDto? OtherClub,
    string? OtherForm,
    /// <summary>Whether the other player (host for a guest, guest for the host) is connected now.</summary>
    bool OtherPresent,
    JsonElement? LastState);

public enum Seat
{
    Host,
    Guest,
    Spectator,
}

public static class SeatNames
{
    public static string Name(this Seat seat) => seat switch
    {
        Seat.Host => "host",
        Seat.Guest => "guest",
        _ => "spectator",
    };
}
