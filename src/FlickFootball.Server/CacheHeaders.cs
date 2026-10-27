namespace FlickFootball.Server;

/// <summary>Cache rules for the client build served from wwwroot.</summary>
public static class CacheHeaders
{
    public const string Forever = "public, max-age=31536000, immutable";
    public const string Revalidate = "no-cache";

    /// <summary>Hashed files under /assets/ never change; everything else (the page, the icon) is revalidated.</summary>
    public static void Apply(HttpContext http) =>
        http.Response.Headers.CacheControl =
            http.Request.Path.StartsWithSegments("/assets") ? Forever : Revalidate;
}
