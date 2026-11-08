export interface DocumentTarget {
  projectId: string
  path: string | null
}

export function documentTargetFor(target: DocumentTarget | null, projectId: string): DocumentTarget {
  return target?.projectId === projectId ? target : { projectId, path: null }
}
