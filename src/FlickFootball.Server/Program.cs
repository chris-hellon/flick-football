var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

// The Vite build lands in wwwroot; any unknown path (e.g. /m/ABCDE later) gets the app shell.
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapFallbackToFile("index.html");

app.Run();

public partial class Program;
