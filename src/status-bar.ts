import * as vscode from "vscode";

let statusResetTimer: NodeJS.Timeout | undefined;

export function createStatusBar(): vscode.StatusBarItem {
  const statusBar = vscode.window.createStatusBarItem(
    "gistSync.status",
    vscode.StatusBarAlignment.Right,
    100
  );

  statusBar.text = "$(cloud-upload) Gist";
  statusBar.tooltip = "Sync files to GitHub Gist";
  statusBar.command = "gistSync.syncToGist";
  // Visibility controlled by updateStatusBarVisibility in extension.ts

  return statusBar;
}

export function setStatusSyncing(statusBar: vscode.StatusBarItem): void {
  clearStatusResetTimer();
  statusBar.text = "$(sync~spin) Syncing...";
  statusBar.backgroundColor = undefined;
}

export function setStatusSuccess(statusBar: vscode.StatusBarItem): void {
  clearStatusResetTimer();
  statusBar.text = "$(check) Synced";
  statusBar.backgroundColor = undefined;
  statusResetTimer = setTimeout(() => {
    statusBar.text = "$(cloud-upload) Gist";
  }, 3000);
}

export function setStatusError(statusBar: vscode.StatusBarItem): void {
  clearStatusResetTimer();
  statusBar.text = "$(error) Sync Failed";
  statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
}

export function setStatusIdle(statusBar: vscode.StatusBarItem): void {
  clearStatusResetTimer();
  statusBar.text = "$(cloud-upload) Gist";
  statusBar.backgroundColor = undefined;
}

export function clearStatusResetTimer(): void {
  if (statusResetTimer !== undefined) {
    clearTimeout(statusResetTimer);
    statusResetTimer = undefined;
  }
}

export function showStatusBar(statusBar: vscode.StatusBarItem): void {
  statusBar.show();
}

export function hideStatusBar(statusBar: vscode.StatusBarItem): void {
  statusBar.hide();
}
