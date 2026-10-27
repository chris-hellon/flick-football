using System.Text.Json;
using FlickFootball.Server.Online;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;

namespace FlickFootball.Server.Tests;

public sealed class RoomRegistryTests
{
    private static readonly ClubDto Club = new("Baize Rovers", "", "#6b2fa3", "#f2c230", "#5a2690", "stripes");
    private static readonly ClubDto Friend = new("Castlegate Harriers", "CGH", "#f4f1e6", "#1b1b1b", "#efeee8", "hoops");

    private readonly FakeTimeProvider _time = new(new DateTimeOffset(2026, 10, 27, 12, 0, 0, TimeSpan.Zero));
    private readonly MatchOptions _options = new();
    private readonly RoomRegistry _rooms;

    public RoomRegistryTests() => _rooms = new RoomRegistry(Options.Create(_options), _time);

    private string Create(string conn = "host", string ip = "1.1.1.1")
    {
        var (r, _) = _rooms.Create(conn, ip, Club, "4-3-3");
        Assert.True(r.Ok, r.Error);
        return r.Code!;
    }

    private static JsonElement State(string ph = "aim", int tn = 1, int? lk = null, int extraBytes = 0)
    {
        var json = JsonSerializer.Serialize(new
        {
            ph,
            tn,
            lk,
            p = Enumerable.Range(0, 46).Select(i => i * 10).ToArray(),
            st = new string('x', extraBytes),
        });
        return JsonDocument.Parse(json).RootElement.Clone();
    }

    [Fact]
    public void Create_gives_a_five_character_code_and_the_host_seat()
    {
        var (r, _) = _rooms.Create("host", "1.1.1.1", Club, "4-3-3");

        Assert.True(r.Ok);
        Assert.Equal("host", r.Seat);
        Assert.Matches("^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$", r.Code);
        Assert.False(string.IsNullOrEmpty(r.Token));
    }

    [Fact]
    public void Join_takes_the_guest_seat_and_tells_the_host()
    {
        var code = Create();

        var (r, notices) = _rooms.Join("guest", code.ToLowerInvariant(), Friend, "5-3-2", null);

        Assert.True(r.Ok);
        Assert.Equal("guest", r.Seat);
        Assert.Equal("Baize Rovers", r.OtherClub!.Name);
        Assert.Equal("4-3-3", r.OtherForm);
        var joined = Assert.Single(notices);
        Assert.Equal("GuestJoined", joined.Method);
        Assert.Equal(["host"], joined.To);
        Assert.Equal("Castlegate Harriers", ((ClubDto)joined.Args[0]!).Name);
        Assert.Equal("5-3-2", joined.Args[1]);
    }

    [Fact]
    public void Join_with_an_unknown_code_fails_politely()
    {
        var (r, _) = _rooms.Join("guest", "ZZZZZ", Friend, "4-4-2", null);

        Assert.False(r.Ok);
        Assert.Contains("No match found with code ZZZZZ", r.Error);
    }

    [Fact]
    public void A_dropped_guest_rejoins_with_their_token_and_gets_the_seat_and_latest_state_back()
    {
        var code = Create();
        var (first, _) = _rooms.Join("guest-1", code, Friend, "4-4-2", null);
        _rooms.Publish("host", State());

        var left = Assert.Single(_rooms.Disconnected("guest-1"));
        Assert.Equal("GuestLeft", left.Method);
        // Someone else arriving meanwhile only gets a spectator seat: the guest's is held.
        Assert.Equal("spectator", _rooms.Join("other", code, Club, "4-4-2", null).Result.Seat);

        var (again, notices) = _rooms.Join("guest-2", code, Friend, "4-4-2", first.Token);

        Assert.Equal("guest", again.Seat);
        Assert.Equal(first.Token, again.Token);
        Assert.Equal("aim", again.LastState!.Value.GetProperty("ph").GetString());
        Assert.True(again.OtherPresent);
        Assert.Contains(notices, n => n.Method == "GuestJoined" && n.To.Contains("host"));
    }

    [Fact]
    public void A_dropped_host_rejoins_with_their_token()
    {
        var code = Create();
        var (host, _) = _rooms.Create("host-1", "1.1.1.1", Club, "4-4-2");
        _rooms.Join("guest", host.Code, Friend, "4-4-2", null);

        var left = Assert.Single(_rooms.Disconnected("host-1"));
        Assert.Equal("HostLeft", left.Method);
        Assert.Equal(["guest"], left.To);

        var (again, notices) = _rooms.Join("host-2", host.Code, Club, "4-4-2", host.Token);

        Assert.Equal("host", again.Seat);
        Assert.Equal("Castlegate Harriers", again.OtherClub!.Name);
        Assert.True(again.OtherPresent);
        Assert.Contains(notices, n => n.Method == "HostReturned" && n.To.Contains("guest"));
        Assert.NotEqual(code, host.Code);
    }

    [Fact]
    public void Extra_joiners_become_spectators_up_to_the_limit_then_the_match_is_full()
    {
        var code = Create();
        _rooms.Join("guest", code, Friend, "4-4-2", null);

        for (var i = 0; i < _options.MaxSpectators; i++)
            Assert.Equal("spectator", _rooms.Join($"spec-{i}", code, Club, "4-4-2", null).Result.Seat);

        var (r, _) = _rooms.Join("one-too-many", code, Club, "4-4-2", null);
        Assert.False(r.Ok);
        Assert.Equal("This match is full.", r.Error);
    }

    [Fact]
    public void Snapshots_go_to_the_guest_and_spectators_only_from_the_host()
    {
        var code = Create();
        _rooms.Join("guest", code, Friend, "4-4-2", null);
        _rooms.Join("spec", code, Club, "4-4-2", null);

        var (ok, notices) = _rooms.Publish("host", State());
        Assert.True(ok);
        var state = Assert.Single(notices);
        Assert.Equal("State", state.Method);
        Assert.Equal(["guest", "spec"], state.To);

        Assert.False(_rooms.Publish("guest", State()).Accepted);
    }

    [Fact]
    public void Oversized_or_malformed_snapshots_are_dropped()
    {
        Create();

        Assert.False(_rooms.Publish("host", State(extraBytes: _options.MaxStateBytes)).Accepted);
        Assert.False(_rooms.Publish("host", State(ph: "dancing")).Accepted);
        Assert.False(_rooms.Publish("host", JsonDocument.Parse("""{"ph":"aim","tn":1,"p":[1,2,3]}""").RootElement).Accepted);
        Assert.False(_rooms.Publish("host", JsonDocument.Parse("[]").RootElement).Accepted);
        Assert.True(_rooms.Publish("host", State()).Accepted);
    }

    [Fact]
    public void A_legal_guest_flick_reaches_the_host_with_its_speed_clamped()
    {
        var code = Create();
        _rooms.Join("guest", code, Friend, "4-4-2", null);
        _rooms.Publish("host", State(ph: "aim", tn: 1));

        var (ok, notices) = _rooms.Flick("guest", new FlickDto(1, 14, 3000, 0, 0));

        Assert.True(ok);
        var n = Assert.Single(notices);
        Assert.Equal("Flick", n.Method);
        Assert.Equal(["host"], n.To);
        Assert.Equal(1500, ((FlickDto)n.Args[0]!).Vx, 3);
    }

    [Theory]
    [InlineData("aim", 0, null, 14, 0)] // home's turn
    [InlineData("aim", 1, 14, 14, 0)] // that player is locked
    [InlineData("aim", 1, null, 4, 0)] // a home player
    [InlineData("aim", 1, null, 25, 0)] // no such player
    [InlineData("moving", 1, null, 14, 0)] // the ball is still moving
    [InlineData("block", 1, null, 14, 1)] // a block flick on the guest's own turn
    public void Bad_guest_flicks_are_rejected(string ph, int tn, int? lk, int id, int block)
    {
        var code = Create();
        _rooms.Join("guest", code, Friend, "4-4-2", null);
        _rooms.Publish("host", State(ph, tn, lk));

        Assert.False(_rooms.Flick("guest", new FlickDto(1, id, 0, -500, block)).Accepted);
    }

    [Fact]
    public void Flicks_need_increasing_sequence_numbers_and_only_come_from_the_guest()
    {
        var code = Create();
        _rooms.Join("guest", code, Friend, "4-4-2", null);
        _rooms.Join("spec", code, Club, "4-4-2", null);
        _rooms.Publish("host", State(ph: "aim", tn: 1));

        Assert.True(_rooms.Flick("guest", new FlickDto(5, 14, 0, -500, 0)).Accepted);
        Assert.True(_rooms.Flick("guest", new FlickDto(6, 21, 0, -500, 0)).Accepted); // its keeper's kick
        Assert.False(_rooms.Flick("guest", new FlickDto(7, 20, 0, -500, 0)).Accepted); // the host's keeper
        Assert.False(_rooms.Flick("guest", new FlickDto(6, 14, 0, -500, 0)).Accepted);
        Assert.False(_rooms.Flick("spec", new FlickDto(8, 14, 0, -500, 0)).Accepted);
        Assert.False(_rooms.Flick("host", new FlickDto(9, 14, 0, -500, 0)).Accepted);
        Assert.False(_rooms.Flick("guest", new FlickDto(10, 14, double.NaN, -500, 0)).Accepted);
    }

    [Fact]
    public void A_block_flick_and_its_skip_are_allowed_during_homes_turn()
    {
        var code = Create();
        _rooms.Join("guest", code, Friend, "4-4-2", null);
        _rooms.Publish("host", State(ph: "block", tn: 0));

        Assert.True(_rooms.Flick("guest", new FlickDto(1, 12, 100, 0, 1)).Accepted);
        Assert.True(_rooms.Skip("guest", 1).Accepted);
        Assert.False(_rooms.Skip("guest", 1).Accepted);
    }

    [Fact]
    public void Restart_taker_moves_reach_the_host_only_on_the_guests_turn()
    {
        var code = Create();
        _rooms.Join("guest", code, Friend, "4-4-2", null);
        _rooms.Join("spec", code, Club, "4-4-2", null);
        _rooms.Publish("host", State(ph: "aim", tn: 1));

        var n = Assert.Single(_rooms.Place("guest", new PlaceDto(14, -20, 300)));
        Assert.Equal("Place", n.Method);
        Assert.Equal(["host"], n.To);
        Assert.Empty(_rooms.Place("spec", new PlaceDto(14, 10, 300)));
        Assert.Empty(_rooms.Place("guest", new PlaceDto(4, 10, 300))); // the host's player
        Assert.Empty(_rooms.Place("guest", new PlaceDto(14, double.NaN, 300)));
        Assert.Empty(_rooms.Place("guest", new PlaceDto(14, -500, 300))); // nowhere a player can stand

        _rooms.Publish("host", State(ph: "aim", tn: 0));
        Assert.Empty(_rooms.Place("guest", new PlaceDto(14, 10, 300)));
    }

    [Fact]
    public void Play_anyone_opens_a_public_match_then_pairs_the_next_player_with_it()
    {
        var (first, _) = _rooms.FindMatch("a", "1.1.1.1", Club, "4-4-2");
        Assert.True(first.Ok);
        Assert.Equal("host", first.Seat);
        Assert.True(_rooms.Find(first.Code!)!.Public);

        var (second, notices) = _rooms.FindMatch("b", "2.2.2.2", Friend, "5-3-2");
        Assert.True(second.Ok);
        Assert.Equal("guest", second.Seat);
        Assert.Equal(first.Code, second.Code);
        Assert.Equal("Baize Rovers", second.OtherClub!.Name);
        Assert.Contains(notices, n => n.Method == "GuestJoined" && n.To.Contains("a"));

        // The match is full now: the next player opens a new public match.
        var (third, _) = _rooms.FindMatch("c", "3.3.3.3", Club, "4-4-2");
        Assert.Equal("host", third.Seat);
        Assert.NotEqual(first.Code, third.Code);
    }

    [Fact]
    public void Play_anyone_skips_private_matches_and_hosts_who_have_dropped()
    {
        var privateCode = Create("p");
        var (waiting, _) = _rooms.FindMatch("a", "1.1.1.1", Club, "4-4-2");
        _rooms.Disconnected("a");

        var (r, _) = _rooms.FindMatch("b", "2.2.2.2", Friend, "4-4-2");
        Assert.Equal("host", r.Seat);
        Assert.NotEqual(privateCode, r.Code);
        Assert.NotEqual(waiting.Code, r.Code);
    }

    [Fact]
    public void Rooms_close_two_minutes_after_the_host_drops()
    {
        var code = Create();
        _rooms.Join("guest", code, Friend, "4-4-2", null);
        _rooms.Disconnected("host");

        _time.Advance(TimeSpan.FromSeconds(90));
        Assert.Empty(_rooms.Expire());
        Assert.NotNull(_rooms.Find(code));

        _time.Advance(TimeSpan.FromSeconds(40));
        var closed = Assert.Single(_rooms.Expire());
        Assert.Equal("RoomClosed", closed.Method);
        Assert.Equal(["guest"], closed.To);
        Assert.Equal("host-left", closed.Args[0]);
        Assert.Null(_rooms.Find(code));
    }

    [Fact]
    public void Rooms_close_after_three_hours_even_while_in_use()
    {
        var code = Create();

        _time.Advance(TimeSpan.FromHours(3) + TimeSpan.FromSeconds(1));
        var closed = Assert.Single(_rooms.Expire());

        Assert.Equal("expired", closed.Args[0]);
        Assert.Null(_rooms.Find(code));
    }

    [Fact]
    public void A_dropped_guests_seat_is_freed_after_the_grace_period()
    {
        var code = Create();
        _rooms.Join("guest", code, Friend, "4-4-2", null);
        _rooms.Disconnected("guest");

        _time.Advance(TimeSpan.FromMinutes(3));
        _rooms.Expire();

        Assert.Equal("guest", _rooms.Join("someone-new", code, Club, "4-4-2", null).Result.Seat);
    }

    [Fact]
    public void The_host_leaving_closes_the_room_and_a_guest_leaving_frees_the_seat()
    {
        var code = Create();
        _rooms.Join("guest", code, Friend, "4-4-2", null);

        var left = Assert.Single(_rooms.Leave("guest"));
        Assert.Equal("GuestLeft", left.Method);
        Assert.Equal("guest", _rooms.Join("guest-2", code, Friend, "4-4-2", null).Result.Seat);

        var closed = Assert.Single(_rooms.Leave("host"));
        Assert.Equal("RoomClosed", closed.Method);
        Assert.Null(_rooms.Find(code));
    }

    [Fact]
    public void Limits_cap_rooms_per_ip_rooms_in_total_and_connections()
    {
        _options.MaxRoomsPerIp = 2;
        _options.MaxRooms = 3;
        _options.MaxConnections = 2;

        Assert.True(_rooms.Create("a", "1.1.1.1", Club, null).Result.Ok);
        Assert.True(_rooms.Create("b", "1.1.1.1", Club, null).Result.Ok);
        Assert.False(_rooms.Create("c", "1.1.1.1", Club, null).Result.Ok);
        Assert.True(_rooms.Create("d", "2.2.2.2", Club, null).Result.Ok);
        Assert.False(_rooms.Create("e", "3.3.3.3", Club, null).Result.Ok);
        Assert.Equal(3, _rooms.RoomCount);

        Assert.True(_rooms.TryConnect());
        Assert.True(_rooms.TryConnect());
        Assert.False(_rooms.TryConnect());
        _rooms.Disconnected("nobody");
        Assert.True(_rooms.TryConnect());
    }

    [Fact]
    public void Club_updates_are_cleaned_and_relayed_to_the_other_side()
    {
        var code = Create();
        _rooms.Join("guest", code, Friend, "4-4-2", null);

        var n = Assert.Single(_rooms.UpdateClub("guest", new ClubDto("Evil\u0007<b>Name that is far too long", "a-b!c9", "red", "#ABCDEF", null, "zigzag"), "9-0-1"));

        Assert.Equal(["host"], n.To);
        var c = (ClubDto)n.Args[0]!;
        Assert.Equal("Evil<b>Name that is ", c.Name);
        Assert.Equal("ABC", c.Code);
        Assert.Equal("#1b2f6b", c.Shirt);
        Assert.Equal("#abcdef", c.Alt);
        Assert.Equal("solid", c.Pat);
        Assert.Equal("4-4-2", n.Args[1]);
    }

    [Fact]
    public void The_rate_limiter_drops_then_flags_abuse()
    {
        var limiter = new MessageRateLimiter(_time);
        for (var i = 0; i < 15; i++) Assert.Equal(RateVerdict.Allow, limiter.Check("c", 15));
        Assert.Equal(RateVerdict.Drop, limiter.Check("c", 15));
        for (var i = 0; i < 29; i++) limiter.Check("c", 15);
        Assert.Equal(RateVerdict.Abuse, limiter.Check("c", 15));

        _time.Advance(TimeSpan.FromSeconds(1));
        Assert.Equal(RateVerdict.Allow, limiter.Check("c", 15));
    }
}
