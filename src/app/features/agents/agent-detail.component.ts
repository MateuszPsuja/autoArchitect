import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { AgentsStore } from '../../core/agents.store';
import { TagModule } from 'primeng/tag';
import { DEFAULT_SKILL_REGISTRY } from '../../core/prompt-builder.service';

@Component({
  selector: 'app-agent-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink, ButtonModule, InputTextModule, TextareaModule, TagModule],
  template: `
    <div class="card">
      @if (agent(); as a) {
        <div class="header-row">
          <p-button
            icon="pi pi-arrow-left"
            label="Back to agents"
            severity="secondary"
            [outlined]="true"
            routerLink="/agents"
            styleClass="back-button"
          />
          <input
            pInputText
            class="name-input"
            [value]="a.name"
            (input)="onNameChange($any($event.target).value)"
            aria-label="Agent name"
          />
          <p-button
            icon="pi pi-refresh"
            label="Reset to default"
            severity="warn"
            [outlined]="true"
            (onClick)="onResetToDefault()"
            title="Discard all edits and restore the original seeded values"
          />
        </div>

        <label for="agent-description" class="field-label">Description</label>
        <textarea
          pTextarea
          id="agent-description"
          rows="3"
          class="w-full description-input"
          [value]="a.description ?? ''"
          (input)="onDescriptionChange($any($event.target).value)"
          aria-label="Agent description"
        ></textarea>

        <div class="section-header">
          <h3>Skills</h3>
          <span class="text-muted">Edit, add, or remove skills for this agent.</span>
        </div>

        @if (a.skills.length === 0) {
          <p class="text-muted empty-hint">No skills yet — add the first one below.</p>
        }

        <div class="skill-list">
          @for (skill of a.skills; track skill.id) {
            <div class="skill-card">
              <div class="skill-card-header">
                <span class="skill-card-title">{{ skill.name || 'Untitled skill' }}</span>
                <p-button
                  icon="pi pi-trash"
                  severity="danger"
                  [text]="true"
                  title="Delete skill"
                  (onClick)="onRemoveSkill(skill.id)"
                />
              </div>

              <label class="field-label">Name</label>
              <input
                pInputText
                class="w-full"
                [value]="skill.name"
                (input)="onSkillNameChange(skill.id, $any($event.target).value)"
                aria-label="Skill name"
              />

              <label class="field-label">Description</label>
              <input
                pInputText
                class="w-full"
                [value]="skill.description ?? ''"
                (input)="onSkillDescriptionChange(skill.id, $any($event.target).value)"
                aria-label="Skill description"
              />

              @if (stagesFor(a.id, skill.id).length > 0) {
                <div class="used-by">
                  <span class="field-label">Used by stages</span>
                  <div class="used-by-tags">
                    @for (stage of stagesFor(a.id, skill.id); track stage) {
                      <p-tag [value]="stage" severity="info" />
                    }
                  </div>
                </div>
              }

              <label class="field-label">Prompt</label>
              <textarea
                pTextarea
                rows="16"
                class="w-full prompt-input"
                [value]="skill.prompt ?? ''"
                (input)="onSkillPromptChange(skill.id, $any($event.target).value)"
                aria-label="Skill prompt"
                placeholder="Instructions sent to the model when this skill is invoked…"
              ></textarea>
            </div>
          }
        </div>

        <div class="add-skill">
          <h4>Add a skill</h4>
          <label class="field-label">Name</label>
          <input
            pInputText
            class="w-full"
            [value]="newSkillName()"
            (input)="newSkillName.set($any($event.target).value)"
            placeholder="e.g. Code Review"
            aria-label="New skill name"
          />

          <label class="field-label">Description</label>
          <input
            pInputText
            class="w-full"
            [value]="newSkillDescription()"
            (input)="newSkillDescription.set($any($event.target).value)"
            placeholder="What this skill does"
            aria-label="New skill description"
          />

          <label class="field-label">Prompt</label>
          <textarea
            pTextarea
            rows="10"
            class="w-full prompt-input"
            [value]="newSkillPrompt()"
            (input)="newSkillPrompt.set($any($event.target).value)"
            placeholder="Optional instructions for this skill"
            aria-label="New skill prompt"
          ></textarea>

          <p-button
            label="Add Skill"
            icon="pi pi-plus"
            severity="success"
            (onClick)="onAddSkill()"
            [disabled]="!newSkillName().trim()"
            styleClass="add-skill-button"
          />
        </div>
      } @else {
        <div class="missing">
          <h3>Agent not found</h3>
          <p class="text-muted">No agent exists with id <code>{{ agentId() }}</code>.</p>
          <p-button
            icon="pi pi-arrow-left"
            label="Back to agents"
            severity="secondary"
            [outlined]="true"
            routerLink="/agents"
          />
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .header-row {
      align-items: center;
      display: flex;
      gap: 1rem;
      justify-content: space-between;
      margin-bottom: 1rem;
    }

    .name-input {
      flex: 1;
      font-size: 1.25rem;
      font-weight: 600;
    }

    .description-input {
      min-height: 4.5rem;
      width: 100%;
    }

    .section-header {
      margin: 1.5rem 0 0.75rem;
    }

    .section-header h3 {
      font-size: 1.05rem;
      margin: 0 0 0.25rem;
    }

    .empty-hint {
      margin: 0 0 1rem;
    }

    .skill-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .skill-card {
      background: var(--surface-ground);
      border: 1px solid var(--surface-border);
      border-radius: var(--radius-md, 6px);
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 1rem;
    }

    .skill-card-header {
      align-items: center;
      display: flex;
      justify-content: space-between;
    }

    .skill-card-title {
      font-weight: 600;
    }

    .prompt-input {
      min-height: 30rem;
      resize: vertical;
      width: 100%;
    }

    .add-skill {
      border: 1px dashed var(--surface-border);
      border-radius: var(--radius-md, 6px);
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 1.5rem;
      padding: 1rem;
    }

    .add-skill h4 {
      font-size: 0.95rem;
      margin: 0 0 0.25rem;
    }

    .add-skill-button {
      align-self: flex-start;
      margin-top: 0.5rem;
    }

    .field-label {
      color: var(--text-color-secondary);
      font-size: 0.85rem;
      font-weight: 500;
      margin-top: 0.25rem;
    }

    .missing {
      align-items: flex-start;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 1rem 0;
    }

    .missing code {
      background: var(--surface-ground);
      border: 1px solid var(--surface-border);
      border-radius: 4px;
      padding: 0.1rem 0.35rem;
    }

    .used-by {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .used-by-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
    }

    .w-full {
      width: 100%;
    }

    .text-muted {
      color: var(--text-color-secondary);
      font-size: 0.9rem;
    }
  `,
})
export class AgentDetailComponent {
  protected readonly store = inject(AgentsStore);
  private readonly route = inject(ActivatedRoute);

  protected readonly agentId = computed(() => this.route.snapshot.paramMap.get('id') ?? '');
  protected readonly agent = computed(() => this.store.getAgent(this.agentId()));

  protected readonly newSkillName = signal('');
  protected readonly newSkillDescription = signal('');
  protected readonly newSkillPrompt = signal('');

  protected onNameChange(name: string): void {
    this.store.updateAgent(this.agentId(), { name });
  }

  protected onDescriptionChange(description: string): void {
    this.store.updateAgent(this.agentId(), { description });
  }

  protected onSkillNameChange(skillId: string, name: string): void {
    this.store.updateSkill(this.agentId(), skillId, { name });
  }

  protected onSkillDescriptionChange(skillId: string, description: string): void {
    this.store.updateSkill(this.agentId(), skillId, { description });
  }

  protected onSkillPromptChange(skillId: string, prompt: string): void {
    this.store.updateSkill(this.agentId(), skillId, { prompt });
  }

  protected onRemoveSkill(skillId: string): void {
    this.store.removeSkill(this.agentId(), skillId);
  }

  protected onResetToDefault(): void {
    this.store.resetToDefault(this.agentId());
  }

  protected onAddSkill(): void {
    const name = this.newSkillName().trim();
    if (!name) {
      return;
    }
    const description = this.newSkillDescription().trim();
    const prompt = this.newSkillPrompt().trim();
    this.store.addSkill(this.agentId(), {
      name,
      description: description || undefined,
      prompt: prompt || undefined,
    });
    this.newSkillName.set('');
    this.newSkillDescription.set('');
    this.newSkillPrompt.set('');
  }

  protected stagesFor(agentId: string, skillId: string): string[] {
    const result: string[] = [];
    for (const [stage, ref] of Object.entries(DEFAULT_SKILL_REGISTRY)) {
      if (ref.agentId === agentId && ref.skillId === skillId) {
        result.push(stage);
      }
    }
    return result;
  }
}
