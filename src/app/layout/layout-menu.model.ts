export interface LayoutMenuItem {
  label: string;
  icon: string;
  route: string;
}

export interface LayoutMenuSection {
  label: string;
  items: readonly LayoutMenuItem[];
}

export const LAYOUT_MENU_SECTIONS: readonly LayoutMenuSection[] = [
  {
    label: 'Workspace',
    items: [
      { label: 'Planner', icon: 'pi-sparkles', route: '/planner' },
      { label: 'Editor', icon: 'pi-pencil', route: '/editor' },
      { label: 'Plans', icon: 'pi-folder-open', route: '/plans' },
      { label: 'Export', icon: 'pi-download', route: '/export' },
      { label: 'Import', icon: 'pi-upload', route: '/import' },
      { label: 'Agents', icon: 'pi-android', route: '/agents' },
      { label: 'Config', icon: 'pi-cog', route: '/config' },
    ],
  },
];
