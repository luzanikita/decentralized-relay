export interface ProxyEntry {
  delegate: string;
  proxyType: string;
  delay: number;
}

export interface FolderMember {
  masterAccount: string;       // ss58
  role: 'full' | 'read-only';
}
