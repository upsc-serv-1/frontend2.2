import { useState, useEffect, useMemo, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

export interface PilotNoteNode {
  id: string;
  user_id: string;
  title: string;
  type: 'folder' | 'note';
  parent_id: string | null;
  note_id: string | null;
  updated_at: string;
  is_pinned: boolean;
  is_archived: boolean;
}

export interface RecursiveFolder {
  id: string;
  name: string;
  type: 'folder';
  parentId: string | null;
  children: (RecursiveFolder | PilotNoteNode)[];
  totalCount: number;
}

export function useNotesPilotVault(userId: string | undefined) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any>(null);
  const [rawNodes, setRawNodes] = useState<PilotNoteNode[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchVaultData = useCallback(async () => {
    if (!userId) return;
    const cacheKey = `notes_vault_cache_${userId}`;
    
    try {
      if (rawNodes.length === 0) {
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached) setRawNodes(JSON.parse(cached));
        else setLoading(true);
      }
    } catch (e) {}
    
    try {
      const { data, error: fetchError } = await supabase
        .from('user_note_nodes')
        .select('*')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .order('title');

      if (fetchError) throw fetchError;
      const nodes = data || [];
      setRawNodes(nodes);
      await AsyncStorage.setItem(cacheKey, JSON.stringify(nodes));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchVaultData();
  }, [userId]);

  const vaultData = useMemo(() => {
    const filtered = rawNodes.filter(n => 
      searchQuery === '' || n.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const nodeMap: Record<string, RecursiveFolder | PilotNoteNode> = {};
    rawNodes.forEach(n => {
      if (n.type === 'folder') {
        nodeMap[n.id] = { id: n.id, name: n.title, type: 'folder', parentId: n.parent_id, children: [], totalCount: 0 };
      } else {
        nodeMap[n.id] = { ...n };
      }
    });

    const roots: (RecursiveFolder | PilotNoteNode)[] = [];
    rawNodes.forEach(n => {
      const item = nodeMap[n.id];
      if (!n.parent_id) {
        roots.push(item);
      } else {
        const parent = nodeMap[n.parent_id] as RecursiveFolder;
        if (parent && parent.children) {
          parent.children.push(item);
        } else {
          roots.push(item); // Orphan
        }
      }
    });

    // Recursive count helper
    const countNotes = (item: RecursiveFolder | PilotNoteNode): number => {
      if (item.type === 'note') return 1;
      const folder = item as RecursiveFolder;
      folder.totalCount = folder.children.reduce((acc, child) => acc + countNotes(child), 0);
      return folder.totalCount;
    };

    roots.forEach(countNotes);

    return {
      tree: roots.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        const aName = a.type === 'folder' ? a.name : a.title;
        const bName = b.type === 'folder' ? b.name : b.title;
        return aName.localeCompare(bName);
      }),
      allFolders: Object.values(nodeMap).filter(n => n.type === 'folder') as RecursiveFolder[],
      totalCount: rawNodes.filter(n => n.type === 'note').length,
    };
  }, [rawNodes, searchQuery]);

  return {
    loading,
    error,
    vaultData,
    filters: { searchQuery, setSearchQuery },
    refresh: fetchVaultData
  };
}
