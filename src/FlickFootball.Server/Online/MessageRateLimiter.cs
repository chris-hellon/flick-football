using System.Collections.Concurrent;

namespace FlickFootball.Server.Online;

public enum RateVerdict
{
    Allow,
    Drop,
    /// <summary>Far over the limit: disconnect.</summary>
    Abuse,
}

/// <summary>Per-connection message counts in one-second windows.</summary>
public sealed class MessageRateLimiter(TimeProvider time)
{
    private readonly ConcurrentDictionary<string, Window> _windows = new(StringComparer.Ordinal);

    private sealed class Window
    {
        public long Second;
        public int Count;
    }

    public RateVerdict Check(string connId, int perSecond)
    {
        var now = time.GetUtcNow().ToUnixTimeSeconds();
        var w = _windows.GetOrAdd(connId, _ => new Window { Second = now });
        lock (w)
        {
            if (w.Second != now)
            {
                w.Second = now;
                w.Count = 0;
            }
            w.Count++;
            return w.Count <= perSecond ? RateVerdict.Allow : w.Count <= perSecond * 3 ? RateVerdict.Drop : RateVerdict.Abuse;
        }
    }

    public void Forget(string connId) => _windows.TryRemove(connId, out _);
}
