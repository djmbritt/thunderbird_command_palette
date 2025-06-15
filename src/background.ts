console.log('Background script starting...');
import browser from 'webextension-polyfill';
import { CommandRegistry } from './commands/registry';
console.log('Imports completed');

class ThunderbirdCommandPalette {
  private registry: CommandRegistry;

  constructor() {
    this.registry = new CommandRegistry();
    this.initialize();
  }

  private async initialize(): Promise<void> {
    this.registerDefaultCommands();
    
    browser.commands.onCommand.addListener((command) => {
      if (command === 'open-command-palette') {
        this.openPalette();
      }
    });

    browser.browserAction.onClicked.addListener(() => {
      this.openPalette();
    });

    browser.runtime.onMessage.addListener((message: any, _sender: browser.Runtime.MessageSender, sendResponse: (response?: any) => void) => {
      if (message.type === 'executeCommand' && message.commandId) {
        this.registry.execute(message.commandId)
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: (error as Error).message }));
        return true;
      } else if (message.type === 'getCommands') {
        const commands = this.registry.getAll().map(cmd => ({
          id: cmd.id,
          title: cmd.title,
          description: cmd.description
        }));
        sendResponse({ commands });
        return;
      }
      return;
    });
  }

  private registerDefaultCommands(): void {
    this.registry.register({
      id: 'compose-new-message',
      title: 'Compose New Message',
      description: 'Open a new message composer',
      handler: async () => {
        // Compose API is available in Thunderbird extensions
        await (browser as any).compose.beginNew();
      }
    });

    this.registry.register({
      id: 'search-messages',
      title: 'Search Messages',
      description: 'Search through your messages',
      handler: async () => {
        // Open search in a new tab
        await browser.tabs.create({ url: 'about:3pane?folderPaneVisible=false&messagePaneVisible=false' });
      }
    });

    this.registry.register({
      id: 'open-address-book',
      title: 'Open Address Book',
      description: 'Open the Thunderbird address book',
      handler: async () => {
        // Use the addressBooks API if available, otherwise open in tab
        if ((browser as any).addressBooks) {
          await browser.tabs.create({ url: 'about:addressbook' });
        }
      }
    });

    this.registry.register({
      id: 'open-settings',
      title: 'Open Settings',
      description: 'Open Thunderbird settings',
      handler: async () => {
        await browser.runtime.openOptionsPage();
      }
    });
  }

  private openPalette(): void {
    browser.windows.create({
      url: browser.runtime.getURL('popup.html'),
      type: 'panel',
      width: 600,
      height: 400
    });
  }
}

new ThunderbirdCommandPalette();