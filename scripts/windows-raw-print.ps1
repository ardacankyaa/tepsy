# Sends ESC/POS bytes unchanged to a named Windows printer queue.
# Queue names and paths are data passed through the child environment.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class TepsyRawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DocInfo {
        [MarshalAs(UnmanagedType.LPWStr)] public string name;
        [MarshalAs(UnmanagedType.LPWStr)] public string output;
        [MarshalAs(UnmanagedType.LPWStr)] public string dataType;
    }
    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool OpenPrinter(string name, out IntPtr printer, IntPtr defaults);
    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern uint StartDocPrinter(IntPtr printer, uint level, ref DocInfo info);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr printer);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr printer, IntPtr bytes, uint count, out uint written);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr printer);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr printer);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool AbortPrinter(IntPtr printer);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr printer);

    static void Check(bool result) {
        if (!result) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    public static uint Send(string queue, byte[] data) {
        if (String.IsNullOrWhiteSpace(queue) || data == null || data.Length == 0)
            throw new ArgumentException("Printer queue and receipt bytes are required.");
        IntPtr printer, buffer = IntPtr.Zero;
        Check(OpenPrinter(queue, out printer, IntPtr.Zero));
        bool documentStarted = false;
        try {
            var info = new DocInfo { name = "TEPSY receipt", output = null, dataType = "RAW" };
            uint job = StartDocPrinter(printer, 1, ref info);
            if (job == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
            documentStarted = true;
            Check(StartPagePrinter(printer));
            buffer = Marshal.AllocHGlobal(data.Length);
            Marshal.Copy(data, 0, buffer, data.Length);
            int offset = 0;
            while (offset < data.Length) {
                uint written;
                Check(WritePrinter(printer, IntPtr.Add(buffer, offset), (uint)(data.Length - offset), out written));
                if (written == 0 || written > data.Length - offset)
                    throw new InvalidOperationException("Printer did not accept all receipt bytes.");
                offset += checked((int)written);
            }
            Check(EndPagePrinter(printer));
            Check(EndDocPrinter(printer));
            documentStarted = false;
            return job;
        } finally {
            if (documentStarted) AbortPrinter(printer);
            if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
            ClosePrinter(printer);
        }
    }
}
'@
    $receiptBytes = [IO.File]::ReadAllBytes($env:TEPSY_PRINT_FILE)
    $jobId = [TepsyRawPrinter]::Send($env:TEPSY_PRINT_QUEUE, $receiptBytes)
    @{ accepted = $true; jobId = $jobId } | ConvertTo-Json -Compress
} catch {
    $rootError = $_.Exception.GetBaseException()
    $nativeCode = if ($rootError -is [ComponentModel.Win32Exception]) { $rootError.NativeErrorCode } else { $null }
    [Console]::Error.WriteLine((@{ error = $rootError.Message; win32Code = $nativeCode } | ConvertTo-Json -Compress))
    exit 1
}
