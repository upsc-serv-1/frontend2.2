import { supabase } from '../lib/supabase';

export type NoteNode = {
  id: string;
  user_id: string;
  parent_id: string | null;
  type: 'folder' | 'note';
  title: string;
  note_id: string | null;
  is_pinned?: boolean;
  is_archived?: boolean;
};

export const NoteHierarchy = {
  async listAll(userId: string): Promise<NoteNode[]> {
    const { data, error } = await supabase
      .from('user_note_nodes').select('*')
      .eq('user_id', userId).eq('is_archived', false)
      .order('parent_id', { ascending: true, nullsFirst: true });
    if (error) throw error;
    return (data || []) as NoteNode[];
  },
  async createFolder(userId: string, title: string, parentId: string | null) {
    const { data, error } = await supabase.from('user_note_nodes')
      .insert({ user_id: userId, parent_id: parentId, type: 'folder', title })
      .select().single();
    if (error) throw error;
    return data;
  },
  async rename(userId: string, nodeId: string, title: string) {
    const { error } = await supabase.rpc('rename_note_node', {
      p_node_id: nodeId, p_user_id: userId, p_title: title,
    });
    if (error) throw error;
  },
  async move(userId: string, nodeId: string, newParentId: string | null) {
    const { error } = await supabase.rpc('move_note_node', {
      p_node_id: nodeId, p_user_id: userId, p_new_parent_id: newParentId,
    });
    if (error) throw error;
  },
  async deleteCascade(userId: string, nodeId: string) {
    const { error } = await supabase.rpc('delete_note_node_cascade', {
      p_node_id: nodeId, p_user_id: userId,
    });
    if (error) throw error;
  },
};
