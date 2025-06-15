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
      } else if (message.type === 'searchCommands') {
        const results = this.registry.search(message.query || '').map(result => ({
          command: {
            id: result.command.id,
            title: result.command.title,
            description: result.command.description
          },
          score: result.score,
          matches: result.matches
        }));
        sendResponse({ results });
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
        await this.switchToOrCreateTab('about:3pane?folderPaneVisible=false&messagePaneVisible=false');
      }
    });

    this.registry.register({
      id: 'open-address-book',
      title: 'Open Address Book',
      description: 'Open the Thunderbird address book',
      handler: async () => {
        // Use the addressBooks API if available, otherwise open in tab
        if ((browser as any).addressBooks) {
          await this.switchToOrCreateTab('about:addressbook');
        }
      }
    });

    this.registry.register({
      id: 'open-settings',
      title: 'Open Settings',
      description: 'Open Thunderbird settings',
      handler: async () => {
        await this.openSettings();
      }
    });

    // Register unified folder commands
    this.registerUnifiedFolderCommands();
    
    // Register account-specific folder commands
    this.registerAccountFolderCommands();
  }

  private registerUnifiedFolderCommands(): void {
    const unifiedFolders = [
      { id: 'inbox', title: 'Go to Unified Inbox', folderType: 'inbox' },
      { id: 'drafts', title: 'Go to Unified Drafts', folderType: 'drafts' },
      { id: 'sent', title: 'Go to Unified Sent', folderType: 'sent' },
      { id: 'archives', title: 'Go to Unified Archives', folderType: 'archives' },
      { id: 'templates', title: 'Go to Unified Templates', folderType: 'templates' },
      { id: 'junk', title: 'Go to Unified Junk', folderType: 'junk' },
      { id: 'trash', title: 'Go to Unified Trash', folderType: 'trash' }
    ];

    unifiedFolders.forEach(folder => {
      this.registry.register({
        id: `unified-${folder.id}`,
        title: folder.title,
        description: `Navigate to unified ${folder.id} folder`,
        keywords: [folder.id, 'unified', 'folder'],
        handler: async () => {
          await this.navigateToUnifiedFolder(folder.folderType);
        }
      });
    });
  }

  private async registerAccountFolderCommands(): Promise<void> {
    try {
      // Get all mail accounts
      const accounts = await (browser as any).accounts.list();
      
      accounts.forEach((account: any) => {
        if (account.type === 'imap' || account.type === 'pop3' || account.type === 'nntp') {
          const folderTypes = ['inbox', 'drafts', 'sent', 'archives', 'templates', 'junk', 'trash'];
          
          folderTypes.forEach(folderType => {
            this.registry.register({
              id: `${account.id}-${folderType}`,
              title: `${account.name}: ${folderType.charAt(0).toUpperCase() + folderType.slice(1)}`,
              description: `Go to ${folderType} folder in ${account.name}`,
              keywords: [account.name, folderType, 'folder'],
              handler: async () => {
                await this.navigateToAccountFolder(account.id, folderType);
              }
            });
          });
        }
      });
    } catch (error) {
      console.error('Failed to register account folder commands:', error);
    }
  }

  private async navigateToUnifiedFolder(folderType: string): Promise<void> {
    try {
      // First, try to get unified folders
      const unifiedFolders = await (browser as any).folders.query({ 
        type: folderType,
        isUnified: true 
      });
      
      if (unifiedFolders && unifiedFolders.length > 0) {
        // Navigate to the unified folder directly
        await this.navigateToFolder(unifiedFolders[0]);
        return;
      }

      // Fallback: Try using mailTabs API with unified mode
      const mailTabs = await (browser as any).mailTabs.query({});
      if (mailTabs && mailTabs.length > 0) {
        try {
          await (browser as any).mailTabs.update(mailTabs[0].id, {
            folderPaneVisible: true,
            messagePaneVisible: true,
            displayedFolder: unifiedFolders[0] ? unifiedFolders[0] : null
          });
          await browser.tabs.update(mailTabs[0].id, { active: true });
          return;
        } catch (updateError) {
          console.warn('Failed to update mail tab, trying create:', updateError);
        }
      }

      // Final fallback: Navigate to 3pane with folder parameter
      const folderUrls: { [key: string]: string } = {
        'inbox': 'about:3pane?folderURI=mailbox://nobody@smart%20mailboxes/inbox',
        'drafts': 'about:3pane?folderURI=mailbox://nobody@smart%20mailboxes/drafts',
        'sent': 'about:3pane?folderURI=mailbox://nobody@smart%20mailboxes/sent',
        'archives': 'about:3pane?folderURI=mailbox://nobody@smart%20mailboxes/archives',
        'templates': 'about:3pane?folderURI=mailbox://nobody@smart%20mailboxes/templates',
        'junk': 'about:3pane?folderURI=mailbox://nobody@smart%20mailboxes/junk',
        'trash': 'about:3pane?folderURI=mailbox://nobody@smart%20mailboxes/trash'
      };

      const url = folderUrls[folderType] || 'about:3pane';
      await this.switchToOrCreateTab(url);

    } catch (error) {
      console.error('Failed to navigate to unified folder:', error);
      // Ultimate fallback - just open 3pane
      await this.switchToOrCreateTab('about:3pane');
    }
  }

  private async navigateToFolder(folder: any): Promise<void> {
    try {
      const mailTabs = await (browser as any).mailTabs.query({});
      if (mailTabs && mailTabs.length > 0) {
        await (browser as any).mailTabs.update(mailTabs[0].id, {
          folderPaneVisible: true,
          messagePaneVisible: true,
          displayedFolder: folder
        });
        await browser.tabs.update(mailTabs[0].id, { active: true });
      } else {
        await (browser as any).mailTabs.create({
          folderPaneVisible: true,
          messagePaneVisible: true,
          displayedFolder: folder
        });
      }
    } catch (error) {
      console.error('Failed to navigate to folder:', error);
      throw error;
    }
  }

  private async navigateToAccountFolder(accountId: string, folderType: string): Promise<void> {
    try {
      const folders = await (browser as any).folders.query({ accountId, type: folderType });
      if (folders && folders.length > 0) {
        await this.navigateToFolder(folders[0]);
      } else {
        console.warn(`No ${folderType} folder found for account ${accountId}`);
        // Fallback to opening the main 3pane view
        await this.switchToOrCreateTab('about:3pane');
      }
    } catch (error) {
      console.error('Failed to navigate to account folder:', error);
      // Fallback to opening the main 3pane view
      await this.switchToOrCreateTab('about:3pane');
    }
  }

  private async openSettings(): Promise<void> {
    try {
      // Method 1: Try browser.runtime.openOptionsPage()
      try {
        await browser.runtime.openOptionsPage();
        return;
      } catch (optionsError) {
        console.warn('openOptionsPage failed, trying alternatives:', optionsError);
      }

      // Method 2: Try opening about:preferences
      try {
        await this.switchToOrCreateTab('about:preferences');
        return;
      } catch (preferencesError) {
        console.warn('about:preferences failed, trying alternatives:', preferencesError);
      }

      // Method 3: Try opening about:preferences#general
      try {
        await this.switchToOrCreateTab('about:preferences#general');
        return;
      } catch (generalError) {
        console.warn('about:preferences#general failed, trying alternatives:', generalError);
      }

      // Method 4: Try opening about:config (advanced settings)
      try {
        await this.switchToOrCreateTab('about:config');
        return;
      } catch (configError) {
        console.warn('about:config failed, trying alternatives:', configError);
      }

      // Method 5: Try opening settings through menu
      try {
        await browser.tabs.create({ url: 'chrome://messenger/content/preferences/preferences.xhtml' });
        return;
      } catch (chromeError) {
        console.warn('chrome preferences failed:', chromeError);
      }

      // Final fallback: Just open a new tab with basic URL
      console.error('All settings methods failed, opening basic tab');
      await browser.tabs.create({ url: 'about:blank' });

    } catch (error) {
      console.error('Failed to open settings:', error);
    }
  }

  private async switchToOrCreateTab(url: string): Promise<void> {
    try {
      // Check if there's already a tab with this URL
      const tabs = await browser.tabs.query({ url });
      if (tabs && tabs.length > 0) {
        // Switch to existing tab
        await browser.tabs.update(tabs[0].id!, { active: true });
        // Focus the window containing this tab
        if (tabs[0].windowId) {
          await browser.windows.update(tabs[0].windowId, { focused: true });
        }
      } else {
        // Create new tab
        await browser.tabs.create({ url });
      }
    } catch (error) {
      console.error('Failed to switch to or create tab:', error);
      // Fallback: just create a new tab
      await browser.tabs.create({ url });
    }
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