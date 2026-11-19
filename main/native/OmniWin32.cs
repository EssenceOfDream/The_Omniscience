using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32;

public sealed class OmniWindowInfo
{
    public string id { get; set; }
    public string title { get; set; }
    public int pid { get; set; }
    public string imagePath { get; set; }
    public int x { get; set; }
    public int y { get; set; }
    public int width { get; set; }
    public int height { get; set; }
    public bool minimized { get; set; }
    public bool maximized { get; set; }
    public bool focused { get; set; }
}

public static class OmniWin32
{
    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    private delegate void WinEventProc(IntPtr hook, uint eventType, IntPtr hwnd,
        int idObject, int idChild, uint eventThread, uint eventTime);
    private const int GWL_STYLE = -16;
    private const int GWL_HWNDPARENT = -8;
    private const int WS_CHILD = 0x40000000;
    private const int WS_CAPTION = 0x00C00000;
    private const int WS_THICKFRAME = 0x00040000;
    private const int WS_SYSMENU = 0x00080000;
    private const int WS_MINIMIZEBOX = 0x00020000;
    private const int WS_MAXIMIZEBOX = 0x00010000;
    private const int WS_POPUP = unchecked((int)0x80000000);
    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TOPMOST = 0x00000008;
    private const uint GW_OWNER = 4;
    private const uint MONITOR_DEFAULTTONEAREST = 2;
    private const int SW_HIDE = 0;
    private const int SW_SHOWNOACTIVATE = 4;
    private const int SW_RESTORE = 9;
    private const uint EVENT_SYSTEM_MOVESIZEEND = 0x000B;
    private const uint EVENT_OBJECT_LOCATIONCHANGE = 0x800B;
    private const uint WINEVENT_OUTOFCONTEXT = 0x0000;
    private const uint WINEVENT_SKIPOWNPROCESS = 0x0002;
    private const int OBJID_WINDOW = 0;
    private const int CHILDID_SELF = 0;
    private const int VK_LBUTTON = 0x01;
    private const uint WM_QUIT = 0x0012;
    private const uint PM_NOREMOVE = 0x0000;
    private const uint ABM_NEW = 0x00000000;
    private const uint ABM_REMOVE = 0x00000001;
    private const uint ABM_QUERYPOS = 0x00000002;
    private const uint ABM_SETPOS = 0x00000003;
    private const uint ABM_GETSTATE = 0x00000004;
    private const uint ABE_TOP = 1;
    private const uint ABE_LEFT = 0;
    private const uint ABE_RIGHT = 2;
    private const uint ABE_BOTTOM = 3;
    private const uint ABS_AUTOHIDE = 0x00000001;
    private const uint SPI_SETWORKAREA = 0x002F;
    private const uint SPI_GETWORKAREA = 0x0030;
    private const uint SPI_SETDESKWALLPAPER = 0x0014;
    private const uint SPI_GETDESKWALLPAPER = 0x0073;
    private const uint SPIF_UPDATEINIFILE = 0x0001;
    private const uint SPIF_SENDCHANGE = 0x0002;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const int WM_APP = 0x8000;
    private static readonly HashSet<IntPtr> AppBars = new HashSet<IntPtr>();
    private static readonly Dictionary<IntPtr, RECT> AppBarRectangles = new Dictionary<IntPtr, RECT>();
    private static readonly Dictionary<IntPtr, uint> AppBarEdges = new Dictionary<IntPtr, uint>();
    private static readonly object AppBarSync = new object();
    private static readonly object PanelWindowGuardSync = new object();
    private static readonly HashSet<IntPtr> WindowsBeingConstrained = new HashSet<IntPtr>();
    private static readonly HashSet<IntPtr> PanelWindowGuardExcludedWindows = new HashSet<IntPtr>();
    private static readonly HashSet<IntPtr> DesktopWindows = new HashSet<IntPtr>();
    private static readonly WinEventProc PanelWindowEventCallback = OnPanelWindowEvent;
    private static readonly EnumWindowsProc PanelWindowEnumerator = EnumerateWindowForPanelGuard;
    private static readonly EnumWindowsProc WindowEnumerator = EnumerateWindow;
    private static readonly Dictionary<IntPtr, Thread> ActiveDrags = new Dictionary<IntPtr, Thread>();
    private static readonly Dictionary<IntPtr, bool> ExplorerDesktopIconVisibility = new Dictionary<IntPtr, bool>();
    private static string OriginalDesktopWallpaper;
    private static bool HasOriginalDesktopWallpaper;
    private static bool OriginalWallpaperRegistryValueExists;
    private static string OriginalWallpaperRegistryValue;
    private static RegistryValueKind OriginalWallpaperRegistryValueKind;
    private static RECT OriginalWorkArea;
    private static bool HasOriginalWorkArea;
    private static bool WorkAreaReserved;
    private static Thread PanelWindowGuardThread;
    private static uint PanelWindowGuardThreadId;
    private static IntPtr PanelWindowLocationHook;
    private static IntPtr PanelWindowMoveSizeHook;
    private static readonly ManualResetEvent PanelWindowGuardReady = new ManualResetEvent(false);
    private static string PanelWindowGuardStartError;

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG {
        public IntPtr hwnd;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
        public uint lPrivate;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    private sealed class ShellWindowState {
        public readonly HashSet<int> ProcessIds = new HashSet<int>();
        public readonly List<IntPtr> Taskbars = new List<IntPtr>();
        public readonly List<IntPtr> DesktopViews = new List<IntPtr>();
        public bool HasTaskbar;
        public bool HasDesktop;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct APPBARDATA {
        public int cbSize;
        public IntPtr hWnd;
        public uint uCallbackMessage;
        public uint uEdge;
        public RECT rc;
        public IntPtr lParam;
    }

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr module,
        WinEventProc callback, uint processId, uint threadId, uint flags);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetMessage(out MSG message, IntPtr window, uint minFilter, uint maxFilter);
    [DllImport("user32.dll")]
    private static extern bool PeekMessage(out MSG message, IntPtr window, uint minFilter, uint maxFilter, uint remove);
    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG message);
    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref MSG message);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool PostThreadMessage(uint threadId, uint message, UIntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int maxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hwnd, StringBuilder className, int maxCount);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern bool IsZoomed(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr64(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong32(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr64(IntPtr hwnd, int index, IntPtr value);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongW", SetLastError = true)]
    private static extern int SetWindowLong32(IntPtr hwnd, int index, int value);
    [DllImport("user32.dll")]
    private static extern IntPtr FindWindow(string className, string windowName);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")]
    private static extern IntPtr GetParent(IntPtr child);
    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr MonitorFromRect(ref RECT rect, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string windowName);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(
        IntPtr window, uint message, IntPtr wParam, IntPtr lParam,
        uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool ScreenToClient(IntPtr window, ref POINT point);
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint attach, uint attachTo, bool attachFlag);
    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern IntPtr SetFocus(IntPtr hwnd);
    [DllImport("user32.dll", EntryPoint = "SetThreadDpiAwarenessContext", SetLastError = true)]
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")]
    private static extern bool ShowWindowAsync(IntPtr hwnd, int command);
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int virtualKey);
    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "ShellExecuteW")]
    private static extern IntPtr ShellExecute(IntPtr hwnd, string operation, string file, string parameters, string directory, int showCommand);
    [DllImport("shell32.dll")]
    private static extern UIntPtr SHAppBarMessage(uint message, ref APPBARDATA data);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SystemParametersInfo(uint action, uint parameter, ref RECT value, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SystemParametersInfoW", SetLastError = true)]
    private static extern bool SystemParametersInfo(uint action, uint parameter, StringBuilder value, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SystemParametersInfoW", SetLastError = true)]
    private static extern bool SystemParametersInfo(uint action, uint parameter, string value, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);
    [DllImport("powrprof.dll", SetLastError = true)]
    private static extern bool SetSuspendState(bool hibernate, bool forceCritical, bool disableWakeEvent);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder imageName, ref int size);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")]
    private static extern void SetLastError(uint errorCode);

    // Кеш imagePath по pid — чтобы не дёргать OpenProcess+QueryFullProcessImageName
    // на каждом refresh (500 мс).
    private static readonly Dictionary<uint, string> ImagePathCache = new Dictionary<uint, string>();

    private static OmniWindowInfo ReadWindow(IntPtr hwnd, IntPtr foreground, int ownPid)
    {
        if (!IsWindowVisible(hwnd)) return null;
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        if (pid == ownPid) return null;
        if ((((long)GetWindowLongPtr(hwnd, -20)) & 0x80L) != 0) return null;

        var title = new StringBuilder(2048);
        if (GetWindowText(hwnd, title, title.Capacity) <= 0) return null;
        RECT rect;
        if (!GetWindowRect(hwnd, out rect)) return null;
        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;
        if (width <= 0 || height <= 0) return null;

        return new OmniWindowInfo {
            id = hwnd.ToInt64().ToString(CultureInfo.InvariantCulture),
            title = title.ToString(),
            pid = (int)pid,
            imagePath = GetImagePathCached(pid),
            x = rect.Left,
            y = rect.Top,
            width = width,
            height = height,
            minimized = IsIconic(hwnd),
            maximized = IsZoomed(hwnd),
            focused = hwnd == foreground
        };
    }

    private static string GetImagePathCached(uint pid)
    {
        string cached;
        if (ImagePathCache.TryGetValue(pid, out cached)) return cached;
        string path = GetImagePath(pid);
        ImagePathCache[pid] = path;
        return path;
    }

    private static bool EnumerateWindow(IntPtr hwnd, IntPtr lParam)
    {
        var state = (EnumerationState)GCHandle.FromIntPtr(lParam).Target;
        OmniWindowInfo window = ReadWindow(hwnd, state.Foreground, state.OwnPid);
        if (window != null) state.Windows.Add(window);
        return true;
    }

    private static bool EnumerateShellWindow(IntPtr hwnd, IntPtr lParam)
    {
        var state = (ShellWindowState)GCHandle.FromIntPtr(lParam).Target;
        var className = new StringBuilder(128);
        if (GetClassName(hwnd, className, className.Capacity) <= 0) return true;
        string name = className.ToString();
        bool isTaskbar = name == "Shell_TrayWnd" || name == "Shell_SecondaryTrayWnd";
        bool isDesktop = name == "Progman" || name == "WorkerW";
        if (!isTaskbar && !isDesktop) return true;

        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        try {
            using (Process process = Process.GetProcessById((int)pid)) {
                if (!string.Equals(process.ProcessName, "explorer", StringComparison.OrdinalIgnoreCase))
                    return true;
            }
        }
        catch (ArgumentException) { return true; }
        catch (InvalidOperationException) { return true; }

        state.ProcessIds.Add((int)pid);
        if (isTaskbar) { state.Taskbars.Add(hwnd); state.HasTaskbar = true; }
        if (isDesktop) {
            state.HasDesktop = true;
            IntPtr desktopView = FindWindowEx(hwnd, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (desktopView != IntPtr.Zero) state.DesktopViews.Add(desktopView);
        }
        return true;
    }

    private static ShellWindowState GetExplorerShellState()
    {
        var state = new ShellWindowState();
        GCHandle handle = GCHandle.Alloc(state);
        try { EnumWindows(EnumerateShellWindow, GCHandle.ToIntPtr(handle)); }
        finally { handle.Free(); }
        return state;
    }

    private static bool IsAnyWindowVisible(List<IntPtr> windows)
    {
        foreach (IntPtr window in windows)
            if (IsWindow(window) && IsWindowVisible(window)) return true;
        return false;
    }

    private static uint GetTaskbarAppBarState(IntPtr taskbar)
    {
        APPBARDATA data = NewAppBarData(taskbar, new RECT());
        return (uint)SHAppBarMessage(ABM_GETSTATE, ref data).ToUInt64();
    }

    public static bool HideExplorerDesktopIcons()
    {
        ShellWindowState state = GetExplorerShellState();
        if (state.DesktopViews.Count == 0) return false;
        foreach (IntPtr desktopView in state.DesktopViews) {
            if (!IsWindow(desktopView)) continue;
            if (!ExplorerDesktopIconVisibility.ContainsKey(desktopView))
                ExplorerDesktopIconVisibility.Add(desktopView, IsWindowVisible(desktopView));
            ShowWindow(desktopView, SW_HIDE);
            if (IsWindowVisible(desktopView)) { RestoreExplorerDesktopIcons(); return false; }
        }
        return true;
    }

    public static bool RestoreExplorerDesktopIcons()
    {
        ShellWindowState state = GetExplorerShellState();
        foreach (IntPtr desktopView in state.DesktopViews) {
            if (!IsWindow(desktopView)) continue;
            bool originalVisibility;
            if (!ExplorerDesktopIconVisibility.TryGetValue(desktopView, out originalVisibility)) continue;
            ShowWindow(desktopView, originalVisibility ? SW_SHOWNOACTIVATE : SW_HIDE);
            if (IsWindowVisible(desktopView) != originalVisibility) return false;
            ExplorerDesktopIconVisibility.Remove(desktopView);
        }
        foreach (IntPtr desktopView in new List<IntPtr>(ExplorerDesktopIconVisibility.Keys))
            if (!IsWindow(desktopView)) ExplorerDesktopIconVisibility.Remove(desktopView);
        return true;
    }

    private static string GetDesktopWallpaper()
    {
        var wallpaper = new StringBuilder(32768);
        if (!SystemParametersInfo(SPI_GETDESKWALLPAPER, (uint)wallpaper.Capacity, wallpaper, 0))
            throw new InvalidOperationException("Could not read the Windows desktop wallpaper: " + Marshal.GetLastWin32Error());
        return wallpaper.ToString();
    }

    private static string FindWallpaperRegistryValueName(RegistryKey key)
    {
        foreach (string name in key.GetValueNames())
            if (string.Equals(name, "Wallpaper", StringComparison.OrdinalIgnoreCase)) return name;
        return null;
    }

    private static bool TryGetWallpaperRegistryValue(out string value, out RegistryValueKind kind)
    {
        using (RegistryKey key = Registry.CurrentUser.OpenSubKey("Control Panel\\Desktop", false)) {
            string name = key == null ? null : FindWallpaperRegistryValueName(key);
            if (name == null) { value = null; kind = RegistryValueKind.String; return false; }
            kind = key.GetValueKind(name);
            if (kind != RegistryValueKind.String && kind != RegistryValueKind.ExpandString)
                throw new InvalidOperationException("Unsupported registry type for the Windows wallpaper value: " + kind);
            value = Convert.ToString(key.GetValue(name, null,
                RegistryValueOptions.DoNotExpandEnvironmentNames));
            return true;
        }
    }

    private static void SetWallpaperRegistryValue(string value, RegistryValueKind kind)
    {
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey("Control Panel\\Desktop")) {
            if (key == null) throw new InvalidOperationException("Could not open the current-user desktop registry key");
            string name = FindWallpaperRegistryValueName(key) ?? "WallPaper";
            key.SetValue(name, value ?? string.Empty, kind);
        }
    }

    private static void RestoreWallpaperRegistryValue()
    {
        if (OriginalWallpaperRegistryValueExists) {
            SetWallpaperRegistryValue(OriginalWallpaperRegistryValue, OriginalWallpaperRegistryValueKind);
            return;
        }
        using (RegistryKey key = Registry.CurrentUser.OpenSubKey("Control Panel\\Desktop", true)) {
            if (key != null) {
                string name = FindWallpaperRegistryValueName(key);
                if (name != null) key.DeleteValue(name, false);
            }
        }
    }

    private static bool IsWallpaperRegistryValueCleared()
    {
        string value; RegistryValueKind kind;
        return TryGetWallpaperRegistryValue(out value, out kind) && string.IsNullOrEmpty(value);
    }

    public static bool HideExplorerWallpaper()
    {
        if (!HasOriginalDesktopWallpaper) {
            OriginalDesktopWallpaper = GetDesktopWallpaper();
            OriginalWallpaperRegistryValueExists = TryGetWallpaperRegistryValue(
                out OriginalWallpaperRegistryValue, out OriginalWallpaperRegistryValueKind);
            HasOriginalDesktopWallpaper = true;
        }
        try {
            RegistryValueKind kind = OriginalWallpaperRegistryValueExists
                ? OriginalWallpaperRegistryValueKind : RegistryValueKind.String;
            SetWallpaperRegistryValue(string.Empty, kind);
            if (!SystemParametersInfo(SPI_SETDESKWALLPAPER, 0, string.Empty,
                SPIF_UPDATEINIFILE | SPIF_SENDCHANGE))
                throw new InvalidOperationException("Could not disable the Windows desktop wallpaper: " + Marshal.GetLastWin32Error());
            SetWallpaperRegistryValue(string.Empty, kind);
            if (IsWallpaperRegistryValueCleared()) return true;
            throw new InvalidOperationException("Windows did not apply the cleared desktop wallpaper setting");
        }
        catch {
            if (!RestoreExplorerWallpaper())
                throw new InvalidOperationException("Wallpaper disable failed and the original wallpaper could not be restored");
            throw;
        }
    }

    public static bool RestoreExplorerWallpaper()
    {
        if (!HasOriginalDesktopWallpaper) return true;
        if (!IsWallpaperRegistryValueCleared()) {
            OriginalDesktopWallpaper = null;
            OriginalWallpaperRegistryValue = null;
            HasOriginalDesktopWallpaper = false;
            return true;
        }
        string wallpaperToRestore = OriginalWallpaperRegistryValueExists
            ? (OriginalWallpaperRegistryValueKind == RegistryValueKind.ExpandString
                ? Environment.ExpandEnvironmentVariables(OriginalWallpaperRegistryValue)
                : OriginalWallpaperRegistryValue)
            : OriginalDesktopWallpaper;
        RestoreWallpaperRegistryValue();
        if (!SystemParametersInfo(SPI_SETDESKWALLPAPER, 0, wallpaperToRestore ?? string.Empty, SPIF_SENDCHANGE))
            return false;
        RestoreWallpaperRegistryValue();
        string registryValue; RegistryValueKind registryKind;
        bool registryValueExists = TryGetWallpaperRegistryValue(out registryValue, out registryKind);
        if (registryValueExists != OriginalWallpaperRegistryValueExists
            || (registryValueExists
                && (!string.Equals(registryValue, OriginalWallpaperRegistryValue, StringComparison.Ordinal)
                    || registryKind != OriginalWallpaperRegistryValueKind)))
            return false;
        if (!string.IsNullOrEmpty(wallpaperToRestore)
            && !string.Equals(GetDesktopWallpaper(), wallpaperToRestore, StringComparison.OrdinalIgnoreCase))
            return false;
        OriginalDesktopWallpaper = null;
        OriginalWallpaperRegistryValue = null;
        HasOriginalDesktopWallpaper = false;
        return true;
    }

    public static bool IsExplorerWallpaperEnabled()
    {
        return !string.IsNullOrEmpty(GetDesktopWallpaper());
    }

    private sealed class EnumerationState {
        public readonly List<OmniWindowInfo> Windows = new List<OmniWindowInfo>();
        public IntPtr Foreground;
        public int OwnPid;
    }

    private static IntPtr GetWindowLongPtr(IntPtr hwnd, int index)
    {
        return IntPtr.Size == 8 ? GetWindowLongPtr64(hwnd, index) : new IntPtr(GetWindowLong32(hwnd, index));
    }

    private static IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value)
    {
        if (IntPtr.Size == 8) return SetWindowLongPtr64(hwnd, index, value);
        return new IntPtr(SetWindowLong32(hwnd, index, value.ToInt32()));
    }

    private static APPBARDATA NewAppBarData(IntPtr hwnd, RECT rect)
    {
        return new APPBARDATA {
            cbSize = Marshal.SizeOf(typeof(APPBARDATA)),
            hWnd = hwnd,
            uCallbackMessage = (uint)(WM_APP + 57),
            uEdge = ABE_TOP,
            rc = rect,
            lParam = IntPtr.Zero
        };
    }

    private static APPBARDATA NewAppBarData(IntPtr hwnd, RECT rect, uint edge)
    {
        APPBARDATA data = NewAppBarData(hwnd, rect);
        data.uEdge = edge;
        return data;
    }

    private static bool SetAsShellBackground(IntPtr window, int x, int y, int width, int height)
    {
        int style = GetWindowLongPtr(window, GWL_STYLE).ToInt32();
        int windowControls = WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
        int topLevelStyle = (style & ~(WS_CHILD | windowControls)) | WS_POPUP;
        SetLastError(0);
        IntPtr previousStyle = SetWindowLongPtr(window, GWL_STYLE, new IntPtr(topLevelStyle));
        int styleError = Marshal.GetLastWin32Error();
        if (previousStyle == IntPtr.Zero && styleError != 0)
            throw new InvalidOperationException("SetWindowLongPtr(GWL_STYLE) failed: " + styleError);

        SetLastError(0);
        IntPtr previousParent = SetParent(window, IntPtr.Zero);
        int parentError = Marshal.GetLastWin32Error();
        if (previousParent == IntPtr.Zero && parentError != 0) {
            SetWindowLongPtr(window, GWL_STYLE, new IntPtr(style));
            throw new InvalidOperationException("SetParent(NULL) failed: " + parentError);
        }

        IntPtr previousOwner = GetWindow(window, GW_OWNER);
        SetLastError(0);
        IntPtr previousWindowOwner = SetWindowLongPtr(window, GWL_HWNDPARENT, IntPtr.Zero);
        int ownerError = Marshal.GetLastWin32Error();
        if ((previousWindowOwner == IntPtr.Zero && ownerError != 0) || GetWindow(window, GW_OWNER) != IntPtr.Zero) {
            SetParent(window, previousParent);
            SetWindowLongPtr(window, GWL_STYLE, new IntPtr(style));
            if (previousOwner != IntPtr.Zero) SetWindowLongPtr(window, GWL_HWNDPARENT, previousOwner);
            throw new InvalidOperationException("Clearing the desktop window owner failed: " + ownerError);
        }

        SetLastError(0);
        IntPtr extendedStyle = GetWindowLongPtr(window, GWL_EXSTYLE);
        if ((extendedStyle.ToInt64() & WS_EX_TOPMOST) != 0) {
            SetLastError(0);
            IntPtr previousExtendedStyle = SetWindowLongPtr(window, GWL_EXSTYLE,
                new IntPtr(extendedStyle.ToInt64() & ~WS_EX_TOPMOST));
            int extendedStyleError = Marshal.GetLastWin32Error();
            if (previousExtendedStyle == IntPtr.Zero && extendedStyleError != 0) {
                SetParent(window, previousParent);
                SetWindowLongPtr(window, GWL_STYLE, new IntPtr(style));
                if (previousOwner != IntPtr.Zero) SetWindowLongPtr(window, GWL_HWNDPARENT, previousOwner);
                throw new InvalidOperationException("Clearing WS_EX_TOPMOST failed: " + extendedStyleError);
            }
        }

        bool positioned = SetWindowPos(window, new IntPtr(1), x, y,
            Math.Max(1, width), Math.Max(1, height), SWP_NOACTIVATE | 0x0020);
        if (!positioned) {
            int positionError = Marshal.GetLastWin32Error();
            SetParent(window, previousParent);
            SetWindowLongPtr(window, GWL_STYLE, new IntPtr(style));
            if (previousOwner != IntPtr.Zero) SetWindowLongPtr(window, GWL_HWNDPARENT, previousOwner);
            throw new InvalidOperationException("SetWindowPos(HWND_BOTTOM) failed: " + positionError);
        }

        RECT actual = new RECT();
        if (!GetWindowRect(window, out actual)
            || actual.Left != x || actual.Top != y
            || actual.Right - actual.Left != width
            || actual.Bottom - actual.Top != height) {
            throw new InvalidOperationException("Desktop window bounds did not match the monitor: "
                + actual.Left + "," + actual.Top + " "
                + (actual.Right - actual.Left) + "x" + (actual.Bottom - actual.Top));
        }
        return true;
    }

    private static bool CaptureOriginalWorkArea()
    {
        if (HasOriginalWorkArea) return true;
        RECT current = new RECT();
        if (!SystemParametersInfo(SPI_GETWORKAREA, 0, ref current, 0)) return false;
        OriginalWorkArea = current;
        HasOriginalWorkArea = true;
        return true;
    }

    private static bool ReserveWorkArea(RECT requested, RECT monitorBounds)
    {
        if (!CaptureOriginalWorkArea()) return false;
        RECT reserved = OriginalWorkArea;
        foreach (var entry in AppBarRectangles) {
            RECT rectangle = entry.Value;
            uint edge = AppBarEdges.ContainsKey(entry.Key) ? AppBarEdges[entry.Key] : ABE_TOP;
            if (edge == ABE_LEFT) {
                reserved.Left = Math.Max(reserved.Left, rectangle.Right);
            } else if (edge == ABE_RIGHT) {
                reserved.Right = Math.Min(reserved.Right, rectangle.Left);
            } else if (edge == ABE_TOP) {
                reserved.Top = Math.Max(reserved.Top, rectangle.Bottom);
            } else if (edge == ABE_BOTTOM) {
                reserved.Bottom = Math.Min(reserved.Bottom, rectangle.Top);
            }
        }
        if (reserved.Left >= reserved.Right || reserved.Top >= reserved.Bottom) return false;
        if (reserved.Left < monitorBounds.Left) reserved.Left = monitorBounds.Left;
        if (reserved.Top < monitorBounds.Top) reserved.Top = monitorBounds.Top;
        if (reserved.Right > monitorBounds.Right) reserved.Right = monitorBounds.Right;
        if (reserved.Bottom > monitorBounds.Bottom) reserved.Bottom = monitorBounds.Bottom;
        if (reserved.Top >= reserved.Bottom) return false;
        if (!SystemParametersInfo(SPI_SETWORKAREA, 0, ref reserved, SPIF_SENDCHANGE)) return false;
        WorkAreaReserved = true;
        return true;
    }

    private static bool RestoreWorkArea()
    {
        if (!HasOriginalWorkArea || !WorkAreaReserved) {
            HasOriginalWorkArea = false;
            WorkAreaReserved = false;
            return true;
        }
        RECT original = OriginalWorkArea;
        if (!SystemParametersInfo(SPI_SETWORKAREA, 0, ref original, SPIF_SENDCHANGE)) return false;
        HasOriginalWorkArea = false;
        WorkAreaReserved = false;
        return true;
    }

    private static bool ReapplyAppBarWorkArea()
    {
        if (!HasOriginalWorkArea) return true;
        RECT reserved = OriginalWorkArea;
        foreach (var entry in AppBarRectangles) {
            RECT rectangle = entry.Value;
            uint edge = AppBarEdges.ContainsKey(entry.Key) ? AppBarEdges[entry.Key] : ABE_TOP;
            if (edge == ABE_LEFT) reserved.Left = Math.Max(reserved.Left, rectangle.Right);
            else if (edge == ABE_RIGHT) reserved.Right = Math.Min(reserved.Right, rectangle.Left);
            else if (edge == ABE_TOP) reserved.Top = Math.Max(reserved.Top, rectangle.Bottom);
            else if (edge == ABE_BOTTOM) reserved.Bottom = Math.Min(reserved.Bottom, rectangle.Top);
        }
        if (reserved.Left >= reserved.Right || reserved.Top >= reserved.Bottom) return false;
        if (!SystemParametersInfo(SPI_SETWORKAREA, 0, ref reserved, SPIF_SENDCHANGE)) return false;
        WorkAreaReserved = true;
        return true;
    }

    private static bool IsWorkAreaReserved(RECT requested, RECT monitorBounds)
    {
        RECT current = new RECT();
        if (!SystemParametersInfo(SPI_GETWORKAREA, 0, ref current, 0)) return false;
        if (AppBarRectangles.Count == 0) return true;
        foreach (var entry in AppBarRectangles) {
            RECT rectangle = entry.Value;
            uint appBarEdge = AppBarEdges.ContainsKey(entry.Key) ? AppBarEdges[entry.Key] : ABE_TOP;
            if (appBarEdge == ABE_LEFT && current.Left < rectangle.Right - 2) return false;
            if (appBarEdge == ABE_RIGHT && current.Right > rectangle.Left + 2) return false;
            if (appBarEdge == ABE_TOP && current.Top < rectangle.Bottom - 2) return false;
            if (appBarEdge == ABE_BOTTOM && current.Bottom > rectangle.Top + 2) return false;
        }
        return true;
    }

    public static bool StartPanelWindowGuard(long[] excludedWindows)
    {
        lock (PanelWindowGuardSync) {
            if (PanelWindowGuardThread != null && PanelWindowGuardThread.IsAlive
                && PanelWindowLocationHook != IntPtr.Zero
                && PanelWindowMoveSizeHook != IntPtr.Zero) return true;
            PanelWindowGuardExcludedWindows.Clear();
            if (excludedWindows != null) {
                foreach (long hwnd in excludedWindows)
                    if (hwnd != 0) PanelWindowGuardExcludedWindows.Add(new IntPtr(hwnd));
            }
            PanelWindowGuardStartError = null;
            PanelWindowGuardReady.Reset();
            PanelWindowGuardThread = new Thread(PanelWindowGuardMessageLoop) {
                IsBackground = true,
                Name = "Omniscience panel window guard"
            };
            PanelWindowGuardThread.Start();
            if (!PanelWindowGuardReady.WaitOne(5000))
                throw new TimeoutException("Timed out while starting the panel window guard");
            if (PanelWindowGuardStartError != null)
                throw new InvalidOperationException(PanelWindowGuardStartError);
            EnumWindows(PanelWindowEnumerator, IntPtr.Zero);
            return true;
        }
    }

    public static bool StopPanelWindowGuard()
    {
        Thread guardThread;
        lock (PanelWindowGuardSync) {
            guardThread = PanelWindowGuardThread;
            if (guardThread == null || !guardThread.IsAlive) return true;
            if (!PostThreadMessage(PanelWindowGuardThreadId, WM_QUIT, UIntPtr.Zero, IntPtr.Zero))
                throw new InvalidOperationException("Could not stop the panel window guard: "
                    + Marshal.GetLastWin32Error());
        }
        if (!guardThread.Join(5000))
            throw new TimeoutException("Timed out while stopping the panel window guard");
        lock (PanelWindowGuardSync) {
            if (PanelWindowGuardThread == guardThread) PanelWindowGuardThread = null;
        }
        return true;
    }

    private static void PanelWindowGuardMessageLoop()
    {
        SetThreadDpiAwarenessContext(new IntPtr(-3));
        MSG message;
        PeekMessage(out message, IntPtr.Zero, 0, 0, PM_NOREMOVE);
        PanelWindowGuardThreadId = GetCurrentThreadId();
        PanelWindowLocationHook = SetWinEventHook(
            EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE, IntPtr.Zero,
            PanelWindowEventCallback, 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
        PanelWindowMoveSizeHook = SetWinEventHook(
            EVENT_SYSTEM_MOVESIZEEND, EVENT_SYSTEM_MOVESIZEEND, IntPtr.Zero,
            PanelWindowEventCallback, 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
        if (PanelWindowLocationHook == IntPtr.Zero || PanelWindowMoveSizeHook == IntPtr.Zero) {
            PanelWindowGuardStartError = "SetWinEventHook failed: " + Marshal.GetLastWin32Error();
            if (PanelWindowLocationHook != IntPtr.Zero) UnhookWinEvent(PanelWindowLocationHook);
            if (PanelWindowMoveSizeHook != IntPtr.Zero) UnhookWinEvent(PanelWindowMoveSizeHook);
            PanelWindowLocationHook = IntPtr.Zero;
            PanelWindowMoveSizeHook = IntPtr.Zero;
            PanelWindowGuardReady.Set();
            return;
        }
        PanelWindowGuardReady.Set();
        while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) {
            TranslateMessage(ref message);
            DispatchMessage(ref message);
        }
        UnhookWinEvent(PanelWindowLocationHook);
        UnhookWinEvent(PanelWindowMoveSizeHook);
        PanelWindowLocationHook = IntPtr.Zero;
        PanelWindowMoveSizeHook = IntPtr.Zero;
        PanelWindowGuardThreadId = 0;
    }

    private static void OnPanelWindowEvent(IntPtr hook, uint eventType, IntPtr window,
        int idObject, int idChild, uint eventThread, uint eventTime)
    {
        if (window == IntPtr.Zero || idObject != OBJID_WINDOW || idChild != CHILDID_SELF) return;
        if (eventType == EVENT_OBJECT_LOCATIONCHANGE
            && (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0) return;
        try {
            ConstrainWindowToPanelArea(window);
        } catch (Exception error) {
            Trace.WriteLine("Panel window guard failed: " + error);
        }
    }

    private static bool EnumerateWindowForPanelGuard(IntPtr window, IntPtr unused)
    {
        try {
            ConstrainWindowToPanelArea(window);
        } catch (Exception error) {
            Trace.WriteLine("Could not constrain an existing window to the panel area: " + error);
        }
        return true;
    }

    private static void ConstrainWindowToPanelArea(IntPtr window)
    {
        if (!IsWindow(window) || !IsWindowVisible(window) || IsIconic(window)) return;
        lock (AppBarSync) {
            if (AppBarRectangles.ContainsKey(window)) return;
        }
        if (IsPanelGuardExempt(window)) return;
        var className = new StringBuilder(256);
        if (GetClassName(window, className, className.Capacity) > 0) {
            string value = className.ToString();
            if (value == "Progman" || value == "WorkerW"
                || value == "Shell_TrayWnd" || value == "Shell_SecondaryTrayWnd") return;
        }
        lock (WindowsBeingConstrained) {
            if (!WindowsBeingConstrained.Add(window)) return;
        }
        try {
            IntPtr monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
            if (monitor == IntPtr.Zero) return;
            MONITORINFO info = new MONITORINFO { cbSize = Marshal.SizeOf(typeof(MONITORINFO)) };
            if (!GetMonitorInfo(monitor, ref info)) return;

            RECT area = GetPanelConstrainedArea(info);
            if (area.Right <= area.Left || area.Bottom <= area.Top) return;

            if (IsZoomed(window)) ShowWindow(window, SW_RESTORE);
            RECT bounds;
            if (!GetWindowRect(window, out bounds)) return;
            RECT constrained = ClampWindowRectToArea(bounds, area);
            if (constrained.Left == bounds.Left && constrained.Top == bounds.Top
                && constrained.Right == bounds.Right && constrained.Bottom == bounds.Bottom) return;

            if (!SetWindowPos(window, IntPtr.Zero, constrained.Left, constrained.Top,
                constrained.Right - constrained.Left, constrained.Bottom - constrained.Top, 0x0010 | 0x0200)) {
                Trace.WriteLine("Could not keep window " + window.ToInt64()
                    + " outside the panel area: " + Marshal.GetLastWin32Error());
            }
        } finally {
            lock (WindowsBeingConstrained) WindowsBeingConstrained.Remove(window);
        }
    }

    private static bool IsPanelGuardExempt(IntPtr window)
    {
        lock (PanelWindowGuardSync) {
            return PanelWindowGuardExcludedWindows.Contains(window)
                || DesktopWindows.Contains(window);
        }
    }

    private static RECT GetPanelConstrainedArea(MONITORINFO info)
    {
        RECT area = info.rcWork;
        lock (AppBarSync) {
            foreach (var panel in AppBarRectangles) {
                RECT bounds = panel.Value;
                if (bounds.Right <= info.rcMonitor.Left || bounds.Left >= info.rcMonitor.Right
                    || bounds.Bottom <= info.rcMonitor.Top || bounds.Top >= info.rcMonitor.Bottom) continue;
                uint edge = AppBarEdges.ContainsKey(panel.Key) ? AppBarEdges[panel.Key] : ABE_TOP;
                if (edge == ABE_TOP && bounds.Top <= info.rcMonitor.Top + 2)
                    area.Top = Math.Max(area.Top, bounds.Bottom);
                else if (edge == ABE_BOTTOM && bounds.Bottom >= info.rcMonitor.Bottom - 2)
                    area.Bottom = Math.Min(area.Bottom, bounds.Top);
                else if (edge == ABE_LEFT && bounds.Left <= info.rcMonitor.Left + 2)
                    area.Left = Math.Max(area.Left, bounds.Right);
                else if (edge == ABE_RIGHT && bounds.Right >= info.rcMonitor.Right - 2)
                    area.Right = Math.Min(area.Right, bounds.Left);
            }
        }
        return area;
    }

    private static RECT ClampWindowRectToArea(RECT bounds, RECT area)
    {
        int width = Math.Min(Math.Max(1, bounds.Right - bounds.Left), area.Right - area.Left);
        int height = Math.Min(Math.Max(1, bounds.Bottom - bounds.Top), area.Bottom - area.Top);
        int x = Math.Max(area.Left, Math.Min(bounds.Left, area.Right - width));
        int y = Math.Max(area.Top, Math.Min(bounds.Top, area.Bottom - height));
        return new RECT { Left = x, Top = y, Right = x + width, Bottom = y + height };
    }

    private static bool PositionFallbackDock(IntPtr window, RECT requested, RECT monitorBounds, int width, int height)
    {
        if (!ReserveWorkArea(requested, monitorBounds)) return false;
        if (SetWindowPos(window, new IntPtr(-1), requested.Left, requested.Top,
            Math.Max(1, width), Math.Max(1, height), SWP_NOACTIVATE)) return true;
        RestoreWorkArea();
        return false;
    }

    private static string GetImagePath(uint pid)
    {
        IntPtr process = OpenProcess(0x1000, false, pid);
        if (process == IntPtr.Zero) return null;
        try {
            var path = new StringBuilder(32768);
            int size = path.Capacity;
            return QueryFullProcessImageName(process, 0, path, ref size) ? path.ToString() : null;
        }
        finally { CloseHandle(process); }
    }

    public static object[] ListWindows(int ownPid)
    {
        var state = new EnumerationState {
            Foreground = GetAncestor(GetForegroundWindow(), 2),
            OwnPid = ownPid,
        };
        if (state.Foreground == IntPtr.Zero) state.Foreground = GetForegroundWindow();
        GCHandle handle = GCHandle.Alloc(state);
        try { EnumWindows(WindowEnumerator, GCHandle.ToIntPtr(handle)); }
        finally { handle.Free(); }
        return state.Windows.ToArray();
    }

    public static void EnablePerMonitorDpiAwareness()
    {
        if (SetThreadDpiAwarenessContext(new IntPtr(-3)) == IntPtr.Zero)
            throw new InvalidOperationException("SetThreadDpiAwarenessContext failed: "
                + Marshal.GetLastWin32Error().ToString(CultureInfo.InvariantCulture));
    }

    public static object GetActiveWindow()
    {
        IntPtr hwnd = GetForegroundWindow();
        hwnd = GetAncestor(hwnd, 2);
        return hwnd == IntPtr.Zero ? null : hwnd.ToInt64().ToString(CultureInfo.InvariantCulture);
    }

    public static object GetExplorerShellStatus()
    {
        ShellWindowState state = GetExplorerShellState();
        IntPtr primaryTaskbar = FindWindow("Shell_TrayWnd", null);
        RECT taskbarBounds = new RECT();
        bool hasTaskbarBounds = primaryTaskbar != IntPtr.Zero
            && GetWindowRect(primaryTaskbar, out taskbarBounds);
        RECT workArea = new RECT();
        if (!SystemParametersInfo(SPI_GETWORKAREA, 0, ref workArea, 0))
            throw new InvalidOperationException("Could not read the Windows work area: " + Marshal.GetLastWin32Error());
        return new {
            running = state.ProcessIds.Count > 0,
            taskbar = state.HasTaskbar,
            desktop = state.HasDesktop,
            taskbarBounds = hasTaskbarBounds ? (object)new {
                x = taskbarBounds.Left,
                y = taskbarBounds.Top,
                width = taskbarBounds.Right - taskbarBounds.Left,
                height = taskbarBounds.Bottom - taskbarBounds.Top
            } : null,
            taskbarVisible = IsAnyWindowVisible(state.Taskbars),
            taskbarAutoHide = state.Taskbars.Count > 0
                && (GetTaskbarAppBarState(state.Taskbars[0]) & ABS_AUTOHIDE) != 0,
            desktopIconsVisible = IsAnyWindowVisible(state.DesktopViews),
            wallpaperEnabled = IsExplorerWallpaperEnabled(),
            wallpaperRegistryDisabled = IsWallpaperRegistryValueCleared(),
            workArea = new {
                x = workArea.Left, y = workArea.Top,
                width = workArea.Right - workArea.Left,
                height = workArea.Bottom - workArea.Top
            },
            processIds = new List<int>(state.ProcessIds).ToArray()
        };
    }

    public static bool StartExplorerShell()
    {
        ShellWindowState state = GetExplorerShellState();
        if (state.HasTaskbar && state.HasDesktop) return true;
        string explorerPath = System.IO.Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe");
        Process.Start(new ProcessStartInfo { FileName = explorerPath, UseShellExecute = true });
        DateTime deadline = DateTime.UtcNow.AddSeconds(15);
        while (DateTime.UtcNow < deadline) {
            Thread.Sleep(250);
            state = GetExplorerShellState();
            if (state.HasTaskbar && state.HasDesktop) return true;
        }
        return false;
    }

    private static bool GetWorkAreaForBounds(RECT bounds, out RECT workArea)
    {
        IntPtr monitor = MonitorFromRect(ref bounds, MONITOR_DEFAULTTONEAREST);
        if (monitor == IntPtr.Zero) {
            workArea = new RECT();
            return false;
        }
        MONITORINFO info = new MONITORINFO { cbSize = Marshal.SizeOf(typeof(MONITORINFO)) };
        if (!GetMonitorInfo(monitor, ref info)) {
            workArea = new RECT();
            return false;
        }
        workArea = info.rcWork;
        return workArea.Right > workArea.Left && workArea.Bottom > workArea.Top;
    }

    private static RECT ClampToWorkArea(int x, int y, int width, int height)
    {
        RECT workArea;
        RECT requested = new RECT {
            Left = x,
            Top = y,
            Right = x + Math.Max(1, width),
            Bottom = y + Math.Max(1, height)
        };
        if (!GetWorkAreaForBounds(requested, out workArea)) {
            throw new InvalidOperationException("Could not read the window's work area");
        }
        width = Math.Max(1, Math.Min(width, workArea.Right - workArea.Left));
        height = Math.Max(1, Math.Min(height, workArea.Bottom - workArea.Top));
        x = Math.Max(workArea.Left, Math.Min(x, workArea.Right - width));
        y = Math.Max(workArea.Top, Math.Min(y, workArea.Bottom - height));
        return new RECT { Left = x, Top = y, Right = x + width, Bottom = y + height };
    }

    public static bool SetBounds(long hwnd, int x, int y, int width, int height)
    {
        IntPtr window = new IntPtr(hwnd);
        if (!IsWindow(window)) return false;
        RECT bounds = ClampToWorkArea(x, y, width, height);
        bool updated = SetWindowPos(window, IntPtr.Zero, bounds.Left, bounds.Top,
            bounds.Right - bounds.Left, bounds.Bottom - bounds.Top, 0x0014);
        if (!updated && Marshal.GetLastWin32Error() == 5) throw new UnauthorizedAccessException("access_denied");
        return updated;
    }

    public static bool SetDesktopBottom(long hwnd)
    {
        IntPtr window = new IntPtr(hwnd);
        if (!IsWindow(window)) return false;
        lock (PanelWindowGuardSync) DesktopWindows.Add(window);
        IntPtr monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
        if (monitor == IntPtr.Zero)
            throw new InvalidOperationException("Could not locate the desktop window's monitor");
        MONITORINFO info = new MONITORINFO { cbSize = Marshal.SizeOf(typeof(MONITORINFO)) };
        if (!GetMonitorInfo(monitor, ref info))
            throw new InvalidOperationException("GetMonitorInfo failed: " + Marshal.GetLastWin32Error());

        RECT bounds = info.rcMonitor;
        if (!SetWindowPos(window, new IntPtr(-2), bounds.Left, bounds.Top,
            bounds.Right - bounds.Left, bounds.Bottom - bounds.Top, SWP_NOACTIVATE)) {
            int error = Marshal.GetLastWin32Error();
            if (error == 5) throw new UnauthorizedAccessException("access_denied");
            throw new InvalidOperationException("SetWindowPos(HWND_NOTOPMOST) failed: " + error);
        }
        if (!SetWindowPos(window, new IntPtr(1), 0, 0, 0, 0, 0x0213)) {
            int error = Marshal.GetLastWin32Error();
            if (error == 5) throw new UnauthorizedAccessException("access_denied");
            throw new InvalidOperationException("SetWindowPos(HWND_BOTTOM) failed: " + error);
        }
        RECT actual;
        if (!GetWindowRect(window, out actual)
            || actual.Left != bounds.Left || actual.Top != bounds.Top
            || actual.Right != bounds.Right || actual.Bottom != bounds.Bottom) {
            throw new InvalidOperationException("Desktop window did not cover its monitor after repositioning");
        }
        return true;
    }

    public static bool SetZOrder(long hwnd, string layer)
    {
        IntPtr insertAfter;
        if (layer == "top") insertAfter = new IntPtr(-1);
        else if (layer == "bottom") insertAfter = new IntPtr(1);
        else if (layer == "normal") insertAfter = new IntPtr(-2);
        else throw new ArgumentException("Unsupported window layer: " + layer);

        bool updated = SetWindowPos(new IntPtr(hwnd), insertAfter, 0, 0, 0, 0, 0x0213);
        if (!updated && Marshal.GetLastWin32Error() == 5)
            throw new UnauthorizedAccessException("access_denied");
        return updated;
    }

    public static bool SetDesktop(long hwnd, int x, int y, int width, int height)
    {
        IntPtr previousDpiContext = SetThreadDpiAwarenessContext(new IntPtr(-3));
        if (previousDpiContext == IntPtr.Zero)
            throw new InvalidOperationException("SetThreadDpiAwarenessContext failed: "
                + Marshal.GetLastWin32Error().ToString(CultureInfo.InvariantCulture));
        try { return SetDesktopWithMonitorBounds(hwnd, x, y, width, height); }
        finally { SetThreadDpiAwarenessContext(previousDpiContext); }
    }

    private static bool SetDesktopWithMonitorBounds(long hwnd, int x, int y, int width, int height)
    {
        IntPtr window = new IntPtr(hwnd);
        IntPtr monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
        if (monitor == IntPtr.Zero)
            throw new InvalidOperationException("Could not locate the desktop window's monitor");
        MONITORINFO monitorInfo = new MONITORINFO { cbSize = Marshal.SizeOf(typeof(MONITORINFO)) };
        if (!GetMonitorInfo(monitor, ref monitorInfo))
            throw new InvalidOperationException("GetMonitorInfo failed: " + Marshal.GetLastWin32Error());
        x = monitorInfo.rcMonitor.Left;
        y = monitorInfo.rcMonitor.Top;
        width = monitorInfo.rcMonitor.Right - x;
        height = monitorInfo.rcMonitor.Bottom - y;

        IntPtr progman = FindWindow("Progman", null);
        if (progman == IntPtr.Zero) return SetAsShellBackground(window, x, y, width, height);

        IntPtr worker = IntPtr.Zero;
        IntPtr messageResult;
        SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(1), 0, 1000, out messageResult);
        EnumWindows((candidate, unused) => {
            if (FindWindowEx(candidate, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) {
                worker = FindWindowEx(IntPtr.Zero, candidate, "WorkerW", null);
                return worker == IntPtr.Zero;
            }
            return true;
        }, IntPtr.Zero);
        IntPtr desktop = worker != IntPtr.Zero ? worker : progman;

        int style = GetWindowLongPtr(window, GWL_STYLE).ToInt32();
        int childStyle = (style | WS_CHILD) & ~WS_POPUP;
        SetLastError(0);
        IntPtr previousStyle = SetWindowLongPtr(window, GWL_STYLE, new IntPtr(childStyle));
        int styleError = Marshal.GetLastWin32Error();
        if (previousStyle == IntPtr.Zero && styleError != 0)
            return SetAsShellBackground(window, x, y, width, height);

        SetLastError(0);
        IntPtr previousParent = SetParent(window, desktop);
        int parentError = Marshal.GetLastWin32Error();
        if (previousParent == IntPtr.Zero && parentError != 0) {
            SetWindowLongPtr(window, GWL_STYLE, new IntPtr(style));
            return SetAsShellBackground(window, x, y, width, height);
        }
        if (GetParent(window) != desktop) {
            SetParent(window, previousParent);
            SetWindowLongPtr(window, GWL_STYLE, new IntPtr(style));
            return SetAsShellBackground(window, x, y, width, height);
        }
        POINT origin = new POINT { X = x, Y = y };
        if (!ScreenToClient(desktop, ref origin)) {
            SetParent(window, previousParent);
            SetWindowLongPtr(window, GWL_STYLE, new IntPtr(style));
            return SetAsShellBackground(window, x, y, width, height);
        }
        bool positioned = SetWindowPos(window, IntPtr.Zero, origin.X, origin.Y,
            Math.Max(1, width), Math.Max(1, height), SWP_NOACTIVATE | 0x0020);
        if (positioned) return true;
        SetParent(window, previousParent);
        SetWindowLongPtr(window, GWL_STYLE, new IntPtr(style));
        return SetAsShellBackground(window, x, y, width, height);
    }

    public static bool SetDock(long hwnd, int x, int y, int width, int height, string edgeName)
    {
        IntPtr window = new IntPtr(hwnd);
        IntPtr monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
        if (monitor == IntPtr.Zero) throw new InvalidOperationException("Could not locate the dock window's monitor");
        MONITORINFO monitorInfo = new MONITORINFO { cbSize = Marshal.SizeOf(typeof(MONITORINFO)) };
        if (!GetMonitorInfo(monitor, ref monitorInfo))
            throw new InvalidOperationException("GetMonitorInfo failed: " + Marshal.GetLastWin32Error());
        RECT monitorBounds = monitorInfo.rcMonitor;
        if (!CaptureOriginalWorkArea()) throw new InvalidOperationException("Could not capture the original Windows work area");
        int requestedHeight = Math.Max(1, height);
        RECT requested = new RECT { Left = x, Top = y, Right = x + Math.Max(1, width), Bottom = y + requestedHeight };
        uint edge = edgeName == "left" ? ABE_LEFT
            : edgeName == "right" ? ABE_RIGHT
            : edgeName == "bottom" ? ABE_BOTTOM
            : ABE_TOP;
        APPBARDATA data = NewAppBarData(window, requested, edge);
        lock (AppBarSync) {
            AppBarRectangles[window] = requested;
            AppBarEdges[window] = edge;
        }
        if (!AppBars.Contains(window)) {
            if (SHAppBarMessage(ABM_NEW, ref data) == UIntPtr.Zero)
                return PositionFallbackDock(window, requested, monitorBounds, width, requestedHeight);
            AppBars.Add(window);
        }
        data = NewAppBarData(window, requested, edge);
        if (SHAppBarMessage(ABM_QUERYPOS, ref data) == UIntPtr.Zero) {
            RemoveDock(hwnd);
            return PositionFallbackDock(window, requested, monitorBounds, width, requestedHeight);
        }
        RECT positionedBounds = data.rc;
        lock (AppBarSync) AppBarRectangles[window] = positionedBounds;
        if (SHAppBarMessage(ABM_SETPOS, ref data) == UIntPtr.Zero) {
            RemoveDock(hwnd);
            return PositionFallbackDock(window, requested, monitorBounds, width, requestedHeight);
        }
        int positionedWidth = positionedBounds.Right - positionedBounds.Left;
        int positionedHeight = positionedBounds.Bottom - positionedBounds.Top;
        bool workAreaReserved = ReserveWorkArea(positionedBounds, monitorBounds);
        bool positioned = SetWindowPos(window, new IntPtr(-1), positionedBounds.Left, positionedBounds.Top,
            positionedWidth, positionedHeight, SWP_NOACTIVATE);
        RECT actual = new RECT();
        bool atRequestedBounds = GetWindowRect(window, out actual)
            && actual.Left == positionedBounds.Left && actual.Top == positionedBounds.Top
            && actual.Right - actual.Left == positionedWidth && actual.Bottom - actual.Top == positionedHeight;
        if (positioned && atRequestedBounds && workAreaReserved && IsWorkAreaReserved(positionedBounds, monitorBounds))
            return true;
        RemoveDock(hwnd);
        return PositionFallbackDock(window, requested, monitorBounds, width, requestedHeight);
    }

    public static bool ResetDock(long hwnd)
    {
        IntPtr window = new IntPtr(hwnd);
        if (!IsWindow(window)) return false;
        bool wasRegistered = AppBars.Contains(window);
        APPBARDATA data = NewAppBarData(window, new RECT());
        UIntPtr removed = SHAppBarMessage(ABM_REMOVE, ref data);
        AppBars.Remove(window);
        lock (AppBarSync) {
            AppBarRectangles.Remove(window);
            AppBarEdges.Remove(window);
        }
        bool restored = AppBars.Count == 0
            ? RestoreWorkArea()
            : ReapplyAppBarWorkArea();
        return (!wasRegistered || removed != UIntPtr.Zero) && restored;
    }

    public static bool RemoveDock(long hwnd)
    {
        IntPtr window = new IntPtr(hwnd);
        bool wasRegistered = AppBars.Remove(window);
        lock (AppBarSync) {
            AppBarRectangles.Remove(window);
            AppBarEdges.Remove(window);
        }
        bool removed = true;
        if (wasRegistered) {
            APPBARDATA data = NewAppBarData(window, new RECT());
            removed = SHAppBarMessage(ABM_REMOVE, ref data) != UIntPtr.Zero;
        }
        bool restored = AppBars.Count == 0
            ? RestoreWorkArea()
            : ReapplyAppBarWorkArea();
        return removed && restored;
    }

    public static bool ResetAllDockReservations()
    {
        bool removed = true;
        foreach (IntPtr window in new List<IntPtr>(AppBars)) {
            APPBARDATA data = NewAppBarData(window, new RECT());
            if (SHAppBarMessage(ABM_REMOVE, ref data) == UIntPtr.Zero) removed = false;
        }
        AppBars.Clear();
        lock (AppBarSync) {
            AppBarRectangles.Clear();
            AppBarEdges.Clear();
        }
        bool restored = RestoreWorkArea();
        return removed && restored;
    }

    public static bool SetCursor(int x, int y) { return SetCursorPos(x, y); }

    public static bool Focus(long hwnd)
    {
        IntPtr window = new IntPtr(hwnd);
        if (!IsWindow(window)) return false;
        IntPtr foreground = GetForegroundWindow();
        if (foreground == window) return true;
        uint currentThread = GetCurrentThreadId();
        uint ignoredPid;
        uint foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, out ignoredPid);
        uint targetThread = GetWindowThreadProcessId(window, out ignoredPid);

        if (IsIconic(window)) ShowWindowAsync(window, 9);

        bool attachedForeground = false;
        bool attachedTarget = false;
        try {
            if (foregroundThread != 0 && currentThread != foregroundThread)
                attachedForeground = AttachThreadInput(currentThread, foregroundThread, true);
            if (targetThread != 0 && currentThread != targetThread)
                attachedTarget = AttachThreadInput(currentThread, targetThread, true);
            SetForegroundWindow(window);
            BringWindowToTop(window);
            SetFocus(window);
            IntPtr active = GetForegroundWindow();
            IntPtr activeRoot = GetAncestor(active, 2);
            IntPtr targetRoot = GetAncestor(window, 2);
            return active == window || activeRoot == targetRoot;
        }
        finally {
            if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
            if (attachedForeground) AttachThreadInput(currentThread, foregroundThread, false);
        }
    }

    public static object PrepareDrag(long hwnd, string mode, string direction)
    {
        IntPtr window = new IntPtr(hwnd);
        if (!IsWindow(window)) return null;
        lock (ActiveDrags) { if (ActiveDrags.ContainsKey(window)) return null; }
        Focus(hwnd);
        RECT rect;
        if (!GetWindowRect(window, out rect)) return null;
        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;
        if (width <= 0 || height <= 0) return null;
        int x = rect.Left + width / 2;
        int y = rect.Top + Math.Min(20, Math.Max(1, height / 3));
        if (mode == "resize") {
            switch (direction) {
                case "nw": x = rect.Left; y = rect.Top; break;
                case "n": y = rect.Top; break;
                case "ne": x = rect.Right - 1; y = rect.Top; break;
                case "e": x = rect.Right - 1; y = rect.Top + height / 2; break;
                case "se": x = rect.Right - 1; y = rect.Bottom - 1; break;
                case "s": y = rect.Bottom - 1; break;
                case "sw": x = rect.Left; y = rect.Bottom - 1; break;
                case "w": x = rect.Left; y = rect.Top + height / 2; break;
            }
        }
        if (!SetCursorPos(x, y)) return null;

        POINT cursor;
        if (!GetCursorPos(out cursor)) return null;
        uint dpi = GetDpiForWindow(window);
        if (dpi == 0) dpi = 96;
        int minWidth = Math.Max(1, (int)Math.Round(120.0 * dpi / 96.0));
        int minHeight = Math.Max(1, (int)Math.Round(80.0 * dpi / 96.0));
        int initialX = rect.Left, initialY = rect.Top, initialWidth = width, initialHeight = height;
        int lastX = initialX, lastY = initialY, lastWidth = initialWidth, lastHeight = initialHeight;
        int startX = cursor.X, startY = cursor.Y;
        string dragMode = mode, resizeDirection = direction;

        Thread dragThread = new Thread(() => {
            try {
                while ((GetAsyncKeyState(0x01) & 0x8000) != 0 && IsWindow(window)) {
                    POINT current;
                    if (GetCursorPos(out current)) {
                        int dx = current.X - startX, dy = current.Y - startY;
                        int nextX = initialX, nextY = initialY, nextWidth = initialWidth, nextHeight = initialHeight;
                        if (dragMode == "move") { nextX += dx; nextY += dy; }
                        else if (dragMode == "resize") {
                            if (resizeDirection.IndexOf('n') >= 0) {
                                nextHeight = Math.Max(minHeight, initialHeight - dy);
                                nextY = initialY + initialHeight - nextHeight;
                            }
                            if (resizeDirection.IndexOf('s') >= 0)
                                nextHeight = Math.Max(minHeight, initialHeight + dy);
                            if (resizeDirection.IndexOf('w') >= 0) {
                                nextWidth = Math.Max(minWidth, initialWidth - dx);
                                nextX = initialX + initialWidth - nextWidth;
                            }
                            if (resizeDirection.IndexOf('e') >= 0)
                                nextWidth = Math.Max(minWidth, initialWidth + dx);
                        }
                        try {
                            RECT constrained = ClampToWorkArea(nextX, nextY, nextWidth, nextHeight);
                            nextX = constrained.Left;
                            nextY = constrained.Top;
                            nextWidth = constrained.Right - constrained.Left;
                            nextHeight = constrained.Bottom - constrained.Top;
                        } catch (InvalidOperationException ex) {
                            Trace.WriteLine(ex);
                            break;
                        }
                        if (nextX != lastX || nextY != lastY || nextWidth != lastWidth || nextHeight != lastHeight) {
                            if (SetWindowPos(window, IntPtr.Zero, nextX, nextY, nextWidth, nextHeight, 0x0014)) {
                                lastX = nextX; lastY = nextY; lastWidth = nextWidth; lastHeight = nextHeight;
                            }
                        }
                    }
                    Thread.Sleep(10);
                }
            }
            finally { lock (ActiveDrags) ActiveDrags.Remove(window); }
        });
        dragThread.IsBackground = true;
        lock (ActiveDrags) {
            if (ActiveDrags.ContainsKey(window)) return null;
            ActiveDrags[window] = dragThread;
        }
        dragThread.Start();
        return new {
            x = rect.Left, y = rect.Top, width, height,
            cursorX = cursor.X, cursorY = cursor.Y, nativeDrag = true
        };
    }

    public static bool Minimize(long hwnd)
    {
        IntPtr window = new IntPtr(hwnd);
        if (!IsWindow(window)) return false;
        ShowWindowAsync(window, 6);
        return true;
    }

    public static bool Maximize(long hwnd, bool maximize)
    {
        IntPtr window = new IntPtr(hwnd);
        if (!IsWindow(window)) return false;
        ShowWindowAsync(window, maximize ? 3 : 9);
        return true;
    }

    public static bool Close(long hwnd) { return PostMessage(new IntPtr(hwnd), 0x0010, IntPtr.Zero, IntPtr.Zero); }

    public static bool LaunchElevated(string executable, string parameters, string directory)
    {
        return ShellExecute(IntPtr.Zero, "runas", executable, parameters, directory, 1).ToInt64() > 32;
    }

    public static bool SuspendComputer()
    {
        bool suspended = SetSuspendState(false, false, false);
        if (!suspended)
            throw new InvalidOperationException("SetSuspendState failed: "
                + Marshal.GetLastWin32Error().ToString(CultureInfo.InvariantCulture));
        return true;
    }

    public static bool ToggleMaximize(long hwnd)
    {
        IntPtr window = new IntPtr(hwnd);
        if (!IsWindow(window)) return false;
        bool currentlyMaximized = IsZoomed(window);
        bool currentlyMinimized = IsIconic(window);
        bool targetMaximized = !currentlyMaximized && !currentlyMinimized;
        ShowWindowAsync(window, targetMaximized ? 3 : 9);
        var sw = System.Diagnostics.Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < 500) {
            if (!IsWindow(window)) return false;
            if (IsZoomed(window) == targetMaximized) return true;
            System.Threading.Thread.Sleep(15);
        }
        return false;
    }
}