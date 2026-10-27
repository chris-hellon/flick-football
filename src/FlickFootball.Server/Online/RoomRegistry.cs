using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace FlickFootball.Server.Online;

/// <summary>A message for the hub to send: method name, recipients and arguments.</summary>
public sealed record Notice(string Method, IReadOnlyList<string> To, object?[] Args);

/// <summary>A seat's rejoin token and its current connection (null while dropped).</summary>
public sealed class SeatHolder
{
    public required string Token { get; init; }
    public string? ConnectionId { get; set; }
    public DateTimeOffset? DroppedAt { get; set; }
}

public sealed class Room
{
    public required string Code { get; init; }
    public required string CreatorIp { get; init; }
    public required DateTimeOffset Created { get; init; }
    /// <summary>Open to anyone who taps "Play anyone", not just people with the code.</summary>
    public bool Public { get; set; }
    public required SeatHolder Host { get; init; }
    public SeatHolder? Guest { get; set; }
    public List<SeatHolder> Spectators { get; } = [];
    public required ClubDto HostClub { get; set; }
    public required string HostForm { get; set; }
    public ClubDto? GuestClub { get; set; }
    public string GuestForm { get; set; } = "4-4-2";
    /// <summary>The latest snapshot's JSON, so a rejoining guest or new spectator sees the pitch at once.</summary>
    public string? LastState { get; set; }
    public StateSummary? Summary { get; set; }
    public long LastFlickN { get; set; }
    public long LastSkipN { get; set; }
}

/// <summary>
/// In-memory rooms and seats. Thread-safe behind one lock (traffic is tiny). Returns the messages to
/// send rather than sending them, so it can be tested without SignalR.
/// </summary>
public sealed class RoomRegistry(IOptions<MatchOptions> options, TimeProvider time)
{
    private static readonly IReadOnlyList<Notice> None = [];
    private readonly MatchOptions _o = options.Value;
    private readonly object _gate = new();
    private readonly Dictionary<string, Room> _rooms = new(StringComparer.Ordinal);
    private readonly Dictionary<string, (Room Room, Seat Seat, SeatHolder Holder)> _byConn = new(StringComparer.Ordinal);
    private int _connections;

    public int RoomCount { get { lock (_gate) return _rooms.Count; } }
    public int ConnectionCount { get { lock (_gate) return _connections; } }

    public Room? Find(string code) { lock (_gate) return _rooms.GetValueOrDefault(code); }

    public bool TryConnect()
    {
        lock (_gate)
        {
            if (_connections >= _o.MaxConnections) return false;
            _connections++;
            return true;
        }
    }

    /// <summary>A connection closed: its seat is kept (empty) for its token, except spectators'.</summary>
    public IReadOnlyList<Notice> Disconnected(string connId)
    {
        lock (_gate)
        {
            _connections = Math.Max(0, _connections - 1);
            if (!_byConn.Remove(connId, out var at) || at.Holder.ConnectionId != connId) return None;
            at.Holder.ConnectionId = null;
            at.Holder.DroppedAt = time.GetUtcNow();
            return at.Seat switch
            {
                Seat.Host => [new("HostLeft", Others(at.Room, Seat.Host), [])],
                Seat.Guest => [new("GuestLeft", Others(at.Room, Seat.Guest), [])],
                _ => DropSpectator(at.Room, at.Holder),
            };
        }
    }

    public (CreateResult Result, IReadOnlyList<Notice> Notices) Create(string connId, string ip, ClubDto? club, string? form)
    {
        lock (_gate)
        {
            var notices = LeaveLocked(connId);
            if (_rooms.Count >= _o.MaxRooms)
                return (new CreateResult(false, "The server is full right now. Try again in a few minutes.", null, null, null), notices);
            if (_rooms.Values.Count(r => r.CreatorIp == ip) >= _o.MaxRoomsPerIp)
                return (new CreateResult(false, "Too many open matches from your connection. Leave one first.", null, null, null), notices);
            string code;
            do code = RandomNumberGenerator.GetString(Validation.CodeChars, Validation.CodeLength);
            while (_rooms.ContainsKey(code));
            var host = new SeatHolder { Token = NewToken(), ConnectionId = connId };
            var room = new Room
            {
                Code = code,
                CreatorIp = ip,
                Created = time.GetUtcNow(),
                Host = host,
                HostClub = Validation.CleanClub(club),
                HostForm = Validation.CleanForm(form),
            };
            _rooms[code] = room;
            _byConn[connId] = (room, Seat.Host, host);
            return (new CreateResult(true, null, code, Seat.Host.Name(), host.Token), notices);
        }
    }

    public (JoinResult Result, IReadOnlyList<Notice> Notices) Join(string connId, string? code, ClubDto? club, string? form, string? token)
    {
        lock (_gate)
        {
            var c = Validation.NormaliseCode(code);
            if (c is null || !_rooms.TryGetValue(c, out var room))
                return (Fail($"No match found with code {code?.Trim().ToUpperInvariant()}. Check the code with your friend, and that their match is still open."), None);
            var notices = new List<Notice>();
            if (_byConn.TryGetValue(connId, out var current) && current.Room != room) notices.AddRange(LeaveLocked(connId));
            var clean = Validation.CleanClub(club);
            var f = Validation.CleanForm(form);
            Seat seat;
            SeatHolder holder;
            if (token is not null && token == room.Host.Token)
            {
                (seat, holder) = (Seat.Host, room.Host);
                room.HostClub = clean;
                room.HostForm = f;
                notices.Add(new("HostReturned", Others(room, Seat.Host, except: connId), []));
            }
            else if (token is not null && room.Guest?.Token == token)
            {
                (seat, holder) = (Seat.Guest, room.Guest);
                (room.GuestClub, room.GuestForm) = (clean, f);
            }
            else if (token is not null && room.Spectators.Find(s => s.Token == token) is { } spec)
            {
                (seat, holder) = (Seat.Spectator, spec);
            }
            else if (room.Guest is null)
            {
                (seat, holder) = (Seat.Guest, new SeatHolder { Token = NewToken() });
                room.Guest = holder;
                (room.GuestClub, room.GuestForm) = (clean, f);
                room.LastFlickN = room.LastSkipN = 0;
            }
            else if (room.Spectators.Count < _o.MaxSpectators)
            {
                (seat, holder) = (Seat.Spectator, new SeatHolder { Token = NewToken() });
                room.Spectators.Add(holder);
            }
            else return (Fail("This match is full."), None);

            // A seat taken back from an older connection: forget that one.
            if (holder.ConnectionId is { } old && old != connId) _byConn.Remove(old);
            holder.ConnectionId = connId;
            holder.DroppedAt = null;
            _byConn[connId] = (room, seat, holder);
            if (seat == Seat.Guest) notices.Add(new("GuestJoined", Others(room, Seat.Guest), [room.GuestClub, room.GuestForm]));

            var other = seat == Seat.Host ? room.GuestClub : room.HostClub;
            var otherForm = seat == Seat.Host ? room.GuestForm : room.HostForm;
            var otherPresent = seat == Seat.Host ? room.Guest?.ConnectionId is not null : room.Host.ConnectionId is not null;
            JsonElement? last = room.LastState is { } s && seat != Seat.Host ? JsonDocument.Parse(s).RootElement.Clone() : null;
            return (new JoinResult(true, null, room.Code, seat.Name(), holder.Token, other, otherForm, otherPresent, last), notices);
        }

        static JoinResult Fail(string error) => new(false, error, null, null, null, null, null, false, null);
    }

    /// <summary>
    /// "Play anyone": takes the guest seat in the longest-waiting public match whose host is here,
    /// or opens a new public match for the next person to join.
    /// </summary>
    public (JoinResult Result, IReadOnlyList<Notice> Notices) FindMatch(string connId, string ip, ClubDto? club, string? form)
    {
        lock (_gate)
        {
            var open = _rooms.Values
                .Where(r => r.Public && r.Guest is null && r.Host.ConnectionId is { } h && h != connId)
                .MinBy(r => r.Created);
            if (open is not null) return Join(connId, open.Code, club, form, null);
            var (created, notices) = Create(connId, ip, club, form);
            if (!created.Ok || created.Code is null)
                return (new JoinResult(false, created.Error, null, null, null, null, null, false, null), notices);
            _rooms[created.Code].Public = true;
            return (new JoinResult(true, null, created.Code, created.Seat, created.Token, null, null, false, null), notices);
        }
    }

    public IReadOnlyList<Notice> UpdateClub(string connId, ClubDto? club, string? form)
    {
        lock (_gate)
        {
            if (!_byConn.TryGetValue(connId, out var at)) return None;
            var clean = Validation.CleanClub(club);
            var f = Validation.CleanForm(form);
            switch (at.Seat)
            {
                case Seat.Host:
                    (at.Room.HostClub, at.Room.HostForm) = (clean, f);
                    return [new("ClubUpdated", Others(at.Room, Seat.Host), [clean, f])];
                case Seat.Guest:
                    (at.Room.GuestClub, at.Room.GuestForm) = (clean, f);
                    return [new("ClubUpdated", Others(at.Room, Seat.Guest), [clean, f])];
                default:
                    return None;
            }
        }
    }

    /// <summary>Stores the host's snapshot and relays it to everyone else. Oversized or malformed ones are dropped.</summary>
    public (bool Accepted, IReadOnlyList<Notice> Notices) Publish(string connId, JsonElement state)
    {
        var raw = state.GetRawText();
        if (Encoding.UTF8.GetByteCount(raw) > _o.MaxStateBytes) return (false, None);
        var summary = StateSummary.Read(state);
        if (summary is null) return (false, None);
        lock (_gate)
        {
            if (!_byConn.TryGetValue(connId, out var at) || at.Seat != Seat.Host) return (false, None);
            at.Room.LastState = raw;
            at.Room.Summary = summary;
            return (true, [new("State", Others(at.Room, Seat.Host), [state.Clone()])]);
        }
    }

    /// <summary>Passes a guest's flick to the host if it is legal right now.</summary>
    public (bool Accepted, IReadOnlyList<Notice> Notices) Flick(string connId, FlickDto? flick)
    {
        var f = Validation.CleanFlick(flick);
        if (f is null) return (false, None);
        lock (_gate)
        {
            if (!_byConn.TryGetValue(connId, out var at) || at.Seat != Seat.Guest) return (false, None);
            var room = at.Room;
            if (room.Summary is not { } s || !s.GuestMayFlick(f) || f.N <= room.LastFlickN) return (false, None);
            if (room.Host.ConnectionId is not { } host) return (false, None);
            room.LastFlickN = f.N;
            return (true, [new("Flick", [host], [f])]);
        }
    }

    /// <summary>Passes a guest's restart-taker move to the host on the guest's turn.</summary>
    public IReadOnlyList<Notice> Place(string connId, PlaceDto? place)
    {
        var p = Validation.CleanPlace(place);
        if (p is null) return None;
        lock (_gate)
        {
            if (!_byConn.TryGetValue(connId, out var at) || at.Seat != Seat.Guest) return None;
            var room = at.Room;
            if (room.Summary is not { GuestMayPlace: true } || room.Host.ConnectionId is not { } host) return None;
            return [new("Place", [host], [p])];
        }
    }

    public IReadOnlyList<Notice> Aim(string connId, AimDto? aim)
    {
        var a = Validation.CleanAim(aim);
        lock (_gate)
        {
            if (!_byConn.TryGetValue(connId, out var at)) return None;
            return at.Seat switch
            {
                Seat.Host => [new("Aim", Others(at.Room, Seat.Host), [a])],
                Seat.Guest when at.Room.Host.ConnectionId is { } host => [new("Aim", [host], [a])],
                _ => None,
            };
        }
    }

    public (bool Accepted, IReadOnlyList<Notice> Notices) Skip(string connId, long n)
    {
        lock (_gate)
        {
            if (!_byConn.TryGetValue(connId, out var at) || at.Seat != Seat.Guest) return (false, None);
            var room = at.Room;
            if (n <= room.LastSkipN || room.Summary is not { GuestMaySkip: true } || room.Host.ConnectionId is not { } host)
                return (false, None);
            room.LastSkipN = n;
            return (true, [new("Skip", [host], [n])]);
        }
    }

    /// <summary>Leaving on purpose: the host closes the room; a guest frees the seat for someone else.</summary>
    public IReadOnlyList<Notice> Leave(string connId)
    {
        lock (_gate) return LeaveLocked(connId);
    }

    /// <summary>Closes rooms whose host has gone or that have run too long; frees long-dropped guest seats.</summary>
    public IReadOnlyList<Notice> Expire()
    {
        lock (_gate)
        {
            var now = time.GetUtcNow();
            var notices = new List<Notice>();
            foreach (var room in _rooms.Values.ToList())
            {
                if (now - room.Created > _o.RoomLifetime) notices.AddRange(Close(room, "expired"));
                else if (room.Host.ConnectionId is null && now - room.Host.DroppedAt > _o.HostGrace)
                    notices.AddRange(Close(room, "host-left"));
                else if (room.Guest is { ConnectionId: null } g && now - g.DroppedAt > _o.SeatGrace)
                {
                    room.Guest = null;
                    room.GuestClub = null;
                }
            }
            return notices;
        }
    }

    private List<Notice> LeaveLocked(string connId)
    {
        if (!_byConn.TryGetValue(connId, out var at)) return [];
        var room = at.Room;
        switch (at.Seat)
        {
            case Seat.Host:
                return Close(room, "host-left");
            case Seat.Guest:
                _byConn.Remove(connId);
                room.Guest = null;
                room.GuestClub = null;
                return [new("GuestLeft", Others(room, Seat.Guest), [])];
            default:
                _byConn.Remove(connId);
                return DropSpectator(room, at.Holder);
        }
    }

    private List<Notice> DropSpectator(Room room, SeatHolder holder)
    {
        room.Spectators.Remove(holder);
        return [];
    }

    private List<Notice> Close(Room room, string reason)
    {
        _rooms.Remove(room.Code);
        var conns = Connections(room).ToList();
        foreach (var c in conns) _byConn.Remove(c);
        return conns.Count > 0 ? [new("RoomClosed", conns, [reason])] : [];
    }

    private static IEnumerable<string> Connections(Room room)
    {
        if (room.Host.ConnectionId is { } h) yield return h;
        if (room.Guest?.ConnectionId is { } g) yield return g;
        foreach (var s in room.Spectators)
        {
            if (s.ConnectionId is { } c) yield return c;
        }
    }

    /// <summary>Everyone connected to the room except the given seat (and, optionally, one connection).</summary>
    private static List<string> Others(Room room, Seat seat, string? except = null)
    {
        var list = new List<string>();
        if (seat != Seat.Host && room.Host.ConnectionId is { } h) list.Add(h);
        if (seat != Seat.Guest && room.Guest?.ConnectionId is { } g) list.Add(g);
        foreach (var s in room.Spectators)
        {
            if (s.ConnectionId is { } c) list.Add(c);
        }
        if (except is not null) list.Remove(except);
        return list;
    }

    private static string NewToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
}
