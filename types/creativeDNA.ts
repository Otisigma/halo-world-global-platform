export type CreativeDNACategory = 'sound' | 'disciplines' | 'tools' | 'themes' | 'beyond';
export type CreativeDNAAudience = 'private' | 'members' | 'public';
export type CreativeDNARelationship = '' | 'inspired' | 'practicing' | 'learning';
export interface CreativeDNATerm {
  id: string;
  category: CreativeDNACategory;
  label: string;
  aliases: readonly string[];
  normalizedKey: string;
  active: boolean;
}
export interface CreativeDNAItem {
  termId: string | null;
  category: CreativeDNACategory;
  label: string;
  relationship: CreativeDNARelationship;
  audience: CreativeDNAAudience;
}
export interface CreativeDNA {
  enabled: boolean;
  audience: CreativeDNAAudience;
  discovery: boolean;
  revision: number;
  items: CreativeDNAItem[];
}
export type VisibleCreativeDNAItem = Omit<CreativeDNAItem, 'audience'>;
