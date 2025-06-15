import browser from 'webextension-polyfill';

interface Command {
  id: string;
  title: string;
  description?: string;
}

class PopupUI {
  private searchInput: HTMLInputElement;
  private commandList: HTMLElement;
  private commands: Command[] = [];
  private filteredCommands: Command[] = [];
  private selectedIndex: number = 0;

  constructor() {
    this.searchInput = document.getElementById('search-input') as HTMLInputElement;
    this.commandList = document.getElementById('command-list') as HTMLElement;
    this.initialize();
  }

  private async initialize(): Promise<void> {
    const response = await browser.runtime.sendMessage({ type: 'getCommands' });
    this.commands = response.commands || [];
    this.filteredCommands = this.commands;
    
    this.renderCommands();
    this.setupEventListeners();
    this.searchInput.focus();
  }

  private setupEventListeners(): void {
    this.searchInput.addEventListener('input', (e) => {
      const query = (e.target as HTMLInputElement).value;
      this.filterCommands(query);
    });

    this.searchInput.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          this.selectNext();
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.selectPrevious();
          break;
        case 'Enter':
          e.preventDefault();
          this.executeSelected();
          break;
        case 'Escape':
          window.close();
          break;
      }
    });

    this.commandList.addEventListener('click', (e) => {
      const commandItem = (e.target as HTMLElement).closest('.command-item');
      if (commandItem) {
        const index = Array.from(this.commandList.children).indexOf(commandItem);
        this.selectedIndex = index;
        this.executeSelected();
      }
    });

    this.commandList.addEventListener('mousemove', (e) => {
      const commandItem = (e.target as HTMLElement).closest('.command-item');
      if (commandItem) {
        const index = Array.from(this.commandList.children).indexOf(commandItem);
        this.selectedIndex = index;
        this.updateSelection();
      }
    });
  }

  private filterCommands(query: string): void {
    if (!query) {
      this.filteredCommands = this.commands;
    } else {
      const normalizedQuery = query.toLowerCase();
      this.filteredCommands = this.commands.filter(command => 
        command.title.toLowerCase().includes(normalizedQuery) ||
        (command.description && command.description.toLowerCase().includes(normalizedQuery))
      );
    }
    this.selectedIndex = 0;
    this.renderCommands();
  }

  private renderCommands(): void {
    this.commandList.innerHTML = '';
    
    if (this.filteredCommands.length === 0) {
      this.commandList.innerHTML = '<div class="no-results">No commands found</div>';
      return;
    }

    this.filteredCommands.forEach((command, index) => {
      const commandItem = document.createElement('div');
      commandItem.className = 'command-item';
      if (index === this.selectedIndex) {
        commandItem.classList.add('selected');
      }
      
      const title = document.createElement('div');
      title.className = 'command-title';
      title.textContent = command.title;
      
      commandItem.appendChild(title);
      
      if (command.description) {
        const description = document.createElement('div');
        description.className = 'command-description';
        description.textContent = command.description;
        commandItem.appendChild(description);
      }
      
      this.commandList.appendChild(commandItem);
    });
  }

  private updateSelection(): void {
    const items = this.commandList.querySelectorAll('.command-item');
    items.forEach((item, index) => {
      if (index === this.selectedIndex) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('selected');
      }
    });
  }

  private selectNext(): void {
    if (this.selectedIndex < this.filteredCommands.length - 1) {
      this.selectedIndex++;
      this.updateSelection();
    }
  }

  private selectPrevious(): void {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
      this.updateSelection();
    }
  }

  private async executeSelected(): Promise<void> {
    if (this.selectedIndex >= 0 && this.selectedIndex < this.filteredCommands.length) {
      const command = this.filteredCommands[this.selectedIndex];
      try {
        await browser.runtime.sendMessage({ 
          type: 'executeCommand', 
          commandId: command.id 
        });
        window.close();
      } catch (error) {
        console.error('Failed to execute command:', error);
      }
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new PopupUI();
});