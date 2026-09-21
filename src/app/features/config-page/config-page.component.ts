import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TabsModule } from 'primeng/tabs';
import { ProviderConfigComponent } from '../provider-config/provider-config.component';
import { WorkspaceSnapshotComponent } from '../provider-config/workspace-snapshot.component';
import { ClearKeysComponent } from './clear-keys.component';

type ConfigTab = 'provider' | 'snapshot' | 'clear';

@Component({
  selector: 'app-config-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TabsModule,
    ProviderConfigComponent,
    WorkspaceSnapshotComponent,
    ClearKeysComponent,
  ],
  template: `
    <p-tabs [value]="active()" (valueChange)="active.set($any($event))">
      <p-tablist>
        <p-tab value="provider">
          <i class="pi pi-cog"></i>
          Provider Configuration
        </p-tab>
        <p-tab value="snapshot">
          <i class="pi pi-download"></i>
          Snapshot
        </p-tab>
        <p-tab value="clear">
          <i class="pi pi-trash"></i>
          Clear Keys
        </p-tab>
      </p-tablist>
      <p-tabpanels>
        <p-tabpanel value="provider">
          <app-provider-config />
        </p-tabpanel>
        <p-tabpanel value="snapshot">
          <app-workspace-snapshot />
        </p-tabpanel>
        <p-tabpanel value="clear">
          <app-clear-keys />
        </p-tabpanel>
      </p-tabpanels>
    </p-tabs>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class ConfigPageComponent {
  protected readonly active = signal<ConfigTab>('provider');
}
