using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace FlickFootball.Server.Online;

/// <summary>Cleans and checks everything peers send. Mirrors the client's checks.</summary>
public static partial class Validation
{
    public const string CodeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    public const int CodeLength = 5;
    public const double MaxSpeed = 1500;

    public static readonly IReadOnlySet<string> Formations =
        new HashSet<string>(["4-4-2", "4-3-3", "3-5-2", "5-3-2", "4-5-1", "4-2-3-1"]);

    public static readonly IReadOnlySet<string> Patterns =
        new HashSet<string>(["solid", "stripes", "hoops", "halves", "sash"]);

    public static readonly IReadOnlySet<string> Phases =
        new HashSet<string>(["menu", "aim", "think", "moving", "block", "blockthink", "pause", "replay", "over"]);

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex HexColour();

    [GeneratedRegex("[^A-Za-z0-9]")]
    private static partial Regex NotAlphanumeric();

    public static ClubDto CleanClub(ClubDto? c)
    {
        var name = new StringBuilder();
        foreach (var ch in (c?.Name ?? "").Trim())
        {
            if (!char.IsControl(ch)) name.Append(ch);
            if (name.Length == 20) break;
        }
        var code = NotAlphanumeric().Replace(c?.Code ?? "", "").ToUpperInvariant();
        return new ClubDto(
            name.ToString(),
            code.Length > 3 ? code[..3] : code,
            Colour(c?.Shirt, "#1b2f6b"),
            Colour(c?.Alt, "#f4f1e6"),
            Colour(c?.Base, "#1d3478"),
            c?.Pat is { } p && Patterns.Contains(p) ? p : "solid");
    }

    private static string Colour(string? v, string fallback) =>
        v is not null && HexColour().IsMatch(v) ? v.ToLowerInvariant() : fallback;

    public static string CleanForm(string? form) => form is not null && Formations.Contains(form) ? form : "4-4-2";

    /// <summary>Upper-cases a typed code and checks it uses the code alphabet.</summary>
    public static string? NormaliseCode(string? code)
    {
        if (code is null) return null;
        var c = code.Trim().ToUpperInvariant();
        return c.Length == CodeLength && c.All(CodeChars.Contains) ? c : null;
    }

    /// <summary>Checks a flick's numbers and clamps its speed. Turn and lock checks need the room.</summary>
    public static FlickDto? CleanFlick(FlickDto? f)
    {
        if (f is null || f.Id is < 10 or > 19 || f.N <= 0) return null;
        if (!double.IsFinite(f.Vx) || !double.IsFinite(f.Vy)) return null;
        var s = Math.Sqrt(f.Vx * f.Vx + f.Vy * f.Vy);
        if (s < 1) return null;
        var k = s > MaxSpeed ? MaxSpeed / s : 1;
        return f with { Vx = f.Vx * k, Vy = f.Vy * k, B = f.B == 1 ? 1 : 0 };
    }

    public static AimDto? CleanAim(AimDto? a)
    {
        if (a is null || a.Id is < 0 or > 19 || !double.IsFinite(a.Vx) || !double.IsFinite(a.Vy)) return null;
        return a with { B = a.B == 1 ? 1 : 0 };
    }
}

/// <summary>The parts of a host snapshot the server needs to judge guest flicks.</summary>
public sealed record StateSummary(string Phase, int Turn, int? Locked)
{
    private const int PositionCount = 46;

    /// <summary>Returns null when the snapshot is malformed and must not be relayed.</summary>
    public static StateSummary? Read(JsonElement s)
    {
        if (s.ValueKind != JsonValueKind.Object) return null;
        if (!s.TryGetProperty("ph", out var ph) || ph.ValueKind != JsonValueKind.String) return null;
        var phase = ph.GetString()!;
        if (!Validation.Phases.Contains(phase)) return null;
        if (!s.TryGetProperty("tn", out var tn) || !IsInt(tn, out var turn) || turn is not (0 or 1)) return null;
        if (!s.TryGetProperty("p", out var p) || p.ValueKind != JsonValueKind.Array || p.GetArrayLength() != PositionCount)
            return null;
        foreach (var v in p.EnumerateArray())
        {
            if (v.ValueKind != JsonValueKind.Number) return null;
        }
        int? locked = s.TryGetProperty("lk", out var lk) && IsInt(lk, out var l) ? l : null;
        return new StateSummary(phase, turn, locked);
    }

    // TryGetInt32 throws on non-numbers, and peers can send anything.
    private static bool IsInt(JsonElement e, out int value)
    {
        value = 0;
        return e.ValueKind == JsonValueKind.Number && e.TryGetInt32(out value);
    }

    /// <summary>The guest (away, team 1) flicks on its own turn, or during home's turn as a block flick.</summary>
    public bool GuestMayFlick(FlickDto f) =>
        (Phase == "aim" && Turn == 1 && f.Id != Locked && f.B == 0) || (Phase == "block" && Turn == 0 && f.B == 1);

    public bool GuestMaySkip => Phase == "block" && Turn == 0;
}
