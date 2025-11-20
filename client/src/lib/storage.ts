
export type SavedTemplate = {
  id: string;
  name: string;
  savedAt: string;
};

export type Project = {
  id: string;
  name: string;
  templates: SavedTemplate[];
  createdAt: string;
  updatedAt: string;
};

const STORAGE_KEYS = {
  TEMPLATES: 'podmate_saved_templates',
  PROJECTS: 'podmate_projects',
  LAST_TEMPLATE: 'podmate_last_template_id',
  CLOUD_CREDENTIALS: 'podmate_cloud_credentials',
};

export function saveTemplate(template: SavedTemplate): void {
  const templates = getSavedTemplates();
  const existingIndex = templates.findIndex(t => t.id === template.id);
  
  if (existingIndex >= 0) {
    templates[existingIndex] = { ...template, savedAt: new Date().toISOString() };
  } else {
    templates.push({ ...template, savedAt: new Date().toISOString() });
  }
  
  localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(templates));
}

export function getSavedTemplates(): SavedTemplate[] {
  const data = localStorage.getItem(STORAGE_KEYS.TEMPLATES);
  return data ? JSON.parse(data) : [];
}

export function deleteTemplate(templateId: string): void {
  const templates = getSavedTemplates();
  const filtered = templates.filter(t => t.id !== templateId);
  localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(filtered));
}

export function saveProject(project: Project): void {
  const projects = getProjects();
  const existingIndex = projects.findIndex(p => p.id === project.id);
  
  const updatedProject = {
    ...project,
    updatedAt: new Date().toISOString(),
  };
  
  if (existingIndex >= 0) {
    projects[existingIndex] = updatedProject;
  } else {
    projects.push({
      ...updatedProject,
      createdAt: new Date().toISOString(),
    });
  }
  
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(projects));
}

export function getProjects(): Project[] {
  const data = localStorage.getItem(STORAGE_KEYS.PROJECTS);
  return data ? JSON.parse(data) : [];
}

export function getProject(projectId: string): Project | null {
  const projects = getProjects();
  return projects.find(p => p.id === projectId) || null;
}

export function deleteProject(projectId: string): void {
  const projects = getProjects();
  const filtered = projects.filter(p => p.id !== projectId);
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(filtered));
}

export function generateProjectId(): string {
  return `project_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function setLastUsedTemplateId(templateId: string): void {
  localStorage.setItem(STORAGE_KEYS.LAST_TEMPLATE, templateId);
}

export function getLastUsedTemplateId(): string | null {
  return localStorage.getItem(STORAGE_KEYS.LAST_TEMPLATE);
}

export type CloudCredentials = {
  dropboxAppKey?: string; // Deprecated - kept for backward compatibility
  dropboxAccessToken?: string; // OAuth access token
  dropboxRefreshToken?: string; // OAuth refresh token
  dropboxTokenExpiry?: number; // Token expiry timestamp
  dropboxLastPath?: string; // Last browsed Dropbox folder path
  googleDriveClientId?: string; // Deprecated - developer only
  googleDriveClientSecret?: string; // Deprecated - developer only
  googleDriveAccessToken?: string; // OAuth access token
  googleDriveRefreshToken?: string; // OAuth refresh token
  googleDriveTokenExpiry?: number; // Token expiry timestamp
  googleDriveLastFolderId?: string; // Last browsed Google Drive folder ID
};

export function saveCloudCredentials(credentials: CloudCredentials): void {
  localStorage.setItem(STORAGE_KEYS.CLOUD_CREDENTIALS, JSON.stringify(credentials));
}

export function getCloudCredentials(): CloudCredentials {
  const data = localStorage.getItem(STORAGE_KEYS.CLOUD_CREDENTIALS);
  return data ? JSON.parse(data) : {};
}

export function clearCloudCredentials(): void {
  localStorage.removeItem(STORAGE_KEYS.CLOUD_CREDENTIALS);
}

