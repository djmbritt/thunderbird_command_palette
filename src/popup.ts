import browser from 'webextension-polyfill';

interface Command {
  id: string;
  title: string;
  description?: string;
}

interface SearchResult {
  command: Command;
  score: number;
  matches: number[];
}

class PopupUI {
  private searchInput: HTMLInputElement;
  private commandList: HTMLElement;
  private searchResults: SearchResult[] = [];
  private selectedIndex: number = 0;

  constructor() {
    this.searchInput = document.getElementById('search-input') as HTMLInputElement;
    this.commandList = document.getElementById('command-list') as HTMLElement;
    this.initialize();
  }

  private async initialize(): Promise<void> {
    await this.search('');
    this.setupEventListeners();
    this.searchInput.focus();
  }

  private async search(query: string): Promise<void> {
    const response = await browser.runtime.sendMessage({ 
      type: 'searchCommands', 
      query 
    });
    this.searchResults = response.results || [];
    this.selectedIndex = 0;
    this.renderCommands();
  }

  private setupEventListeners(): void {
    this.searchInput.addEventListener('input', async (e) => {
      const query = (e.target as HTMLInputElement).value;
      await this.search(query);
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

  private renderCommands(): void {
    this.commandList.innerHTML = '';
    
    if (this.searchResults.length === 0) {
      this.commandList.innerHTML = '<div class="no-results">No commands found</div>';
      return;
    }

    this.searchResults.forEach((result, index) => {
      const command = result.command;
      const commandItem = document.createElement('div');
      commandItem.className = 'command-item';
      if (index === this.selectedIndex) {
        commandItem.classList.add('selected');
      }
      
      const title = document.createElement('div');
      title.className = 'command-title';
      
      // Highlight matched characters in fuzzy search
      if (result.matches.length > 0 && this.searchInput.value) {
        title.innerHTML = this.highlightMatches(command.title, result.matches);
      } else {
        title.textContent = command.title;
      }
      
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

  private highlightMatches(text: string, matches: number[]): string {
    if (matches.length === 0) return text;
    
    let result = '';
    let lastIndex = 0;
    
    // Sort matches to ensure they're in order
    const sortedMatches = [...matches].sort((a, b) => a - b);
    
    for (const matchIndex of sortedMatches) {
      // Only highlight if the match is for the title (not description/keywords)
      if (matchIndex < text.length) {
        result += text.substring(lastIndex, matchIndex);
        result += `<span class="match">${text[matchIndex]}</span>`;
        lastIndex = matchIndex + 1;
      }
    }
    
    result += text.substring(lastIndex);
    return result;
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
    if (this.selectedIndex < this.searchResults.length - 1) {
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
    if (this.selectedIndex >= 0 && this.selectedIndex < this.searchResults.length) {
      const command = this.searchResults[this.selectedIndex].command;
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