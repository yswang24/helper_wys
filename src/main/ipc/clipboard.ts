import { clipboard, ipcMain } from 'electron'
import { SEND } from '../../shared/ipc'

export function registerClipboardIpc(): void {
  ipcMain.on(SEND.clipboardCopy, (_e, text: string) => clipboard.writeText(text))
}
