import { useState, useEffect, useMemo, useCallback } from 'react';
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
}

export interface PilotVaultMicroTopic {
  name: string;
  id: string;
  notes: PilotNoteNode[];
}

export interface PilotVaultSectionGroup {
  name: string;
  id: string;
  microTopics: Record<string, PilotVaultMicroTopic>;
  notes: PilotNoteNode[]; // Direct notes in this folder
  totalCount: number;
}

export interface PilotVaultSubject {
  name: string;
  id: string;
  totalCount: number;
  sectionGroups: Record<string, PilotVaultSectionGroup>;
  notes: PilotNoteNode[]; // Direct notes in root folder
}

export function useNotesPilotVault(userId: string | undefined) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);
  const [rawNodes, setRawNodes] = useState<PilotNoteNode[]>([]);
  
  const [searchQuery, setSearchQuery] = useState('');

  const fetchVaultData = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    // Only show loading if we don't have nodes yet (prevents flicker on refresh)
    if (rawNodes.length === 0) {
      setLoading(true);
    }
    
    try {
      const { data, error: fetchError } = await supabase
        .from('user_note_nodes')
        .select('*')
        .eq('user_id', userId)
        .order('title');

      if (fetchError) throw fetchError;
      setRawNodes(data || []);
    } catch (err) {
      console.error('Notes Pilot Vault Error:', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchVaultData();
  }, [userId]);

  const vaultData = useMemo(() => {
    const filtered = rawNodes.filter(n => {
      const matchesSearch = searchQuery === '' || 
        n.title.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesSearch;
    });

    const rootFolders = filtered.filter(n => n.type === 'folder' && !n.parent_id);
    const subjects: Record<string, PilotVaultSubject> = {};
    
    // Level 1: Root Folders
    rootFolders.forEach(f => {
      subjects[f.id] = { id: f.id, name: f.title, totalCount: 0, sectionGroups: {}, notes: [] };
    });

    // We also might have uncategorized notes. Let's create an "Uncategorized" root folder.
    subjects['uncategorized'] = { id: 'uncategorized', name: 'Uncategorized', totalCount: 0, sectionGroups: {}, notes: [] };

    // Function to find the root folder for any node
    const getRootAndPath = (nodeId: string | null): { rootId: string, level2Id?: string, level3Id?: string } => {
      if (!nodeId) return { rootId: 'uncategorized' };
      const node = filtered.find(n => n.id === nodeId);
      if (!node) return { rootId: 'uncategorized' };
      if (!node.parent_id) return { rootId: node.id };
      
      const parent = filtered.find(n => n.id === node.parent_id);
      if (!parent) return { rootId: 'uncategorized' };
      if (!parent.parent_id) return { rootId: parent.id, level2Id: node.id };
      
      const grandParent = filtered.find(n => n.id === parent.parent_id);
      if (!grandParent) return { rootId: 'uncategorized' };
      if (!grandParent.parent_id) return { rootId: grandParent.id, level2Id: parent.id, level3Id: node.id };
      
      // If deeper, just squash into grandparent
      return { rootId: grandParent.id, level2Id: parent.id, level3Id: node.id };
    };

    // Now populate folders and notes
    filtered.filter(n => n.type === 'folder' && n.parent_id).forEach(f => {
      const { rootId, level2Id } = getRootAndPath(f.parent_id);
      if (subjects[rootId]) {
        if (!level2Id) {
          // It is a level 2 folder
          if (!subjects[rootId].sectionGroups[f.id]) {
            subjects[rootId].sectionGroups[f.id] = { id: f.id, name: f.title, microTopics: {}, notes: [], totalCount: 0 };
          }
        } else {
          // It is a level 3 folder
          if (!subjects[rootId].sectionGroups[level2Id]) {
             const l2 = filtered.find(x => x.id === level2Id);
             subjects[rootId].sectionGroups[level2Id] = { id: level2Id, name: l2?.title || 'Group', microTopics: {}, notes: [], totalCount: 0 };
          }
          if (!subjects[rootId].sectionGroups[level2Id].microTopics[f.id]) {
            subjects[rootId].sectionGroups[level2Id].microTopics[f.id] = { id: f.id, name: f.title, notes: [] };
          }
        }
      }
    });

    const notes = filtered.filter(n => n.type === 'note');
    notes.forEach(n => {
      const { rootId, level2Id, level3Id } = getRootAndPath(n.parent_id);
      if (subjects[rootId]) {
        if (level3Id) {
          if (!subjects[rootId].sectionGroups[level2Id!]) {
             subjects[rootId].sectionGroups[level2Id!] = { id: level2Id!, name: 'Group', microTopics: {}, notes: [], totalCount: 0 };
          }
          if (!subjects[rootId].sectionGroups[level2Id!].microTopics[level3Id]) {
            subjects[rootId].sectionGroups[level2Id!].microTopics[level3Id] = { id: level3Id, name: 'Topic', notes: [] };
          }
          subjects[rootId].sectionGroups[level2Id!].microTopics[level3Id].notes.push(n);
          subjects[rootId].sectionGroups[level2Id!].totalCount++;
        } else if (level2Id) {
          if (!subjects[rootId].sectionGroups[level2Id]) {
             subjects[rootId].sectionGroups[level2Id] = { id: level2Id, name: 'Group', microTopics: {}, notes: [], totalCount: 0 };
          }
          subjects[rootId].sectionGroups[level2Id].notes.push(n);
          subjects[rootId].sectionGroups[level2Id].totalCount++;
        } else {
          subjects[rootId].notes.push(n);
        }
        subjects[rootId].totalCount++;
      }
    });

    // Remove uncategorized if empty
    if (subjects['uncategorized'].totalCount === 0) {
      delete subjects['uncategorized'];
    }

    return {
      filteredNotes: notes,
      subjects: Object.values(subjects).sort((a, b) => b.totalCount - a.totalCount),
      totalCount: notes.length,
    };
  }, [rawNodes, searchQuery]);

  return {
    loading,
    error,
    vaultData,
    filters: {
      searchQuery,
      setSearchQuery,
    },
    refresh: fetchVaultData
  };
}
