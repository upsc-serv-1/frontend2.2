import { supabase } from '../lib/supabase';

export interface BranchNode {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  is_archived: boolean;
  is_deleted: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  // Computed
  level?: number;
  children?: BranchNode[];
  cardCount?: number;
  dueCount?: number;
}

export class FlashcardBranchService {
  static async syncHierarchy(userId: string) {
    console.log(`[FlashcardBranchSvc] Syncing hierarchy for user: ${userId}`);
    
    // 0. Backfill NULL user_ids in mappings for this user's branches
    try {
      const { data: myBranches } = await supabase
        .from('flashcard_branches')
        .select('id')
        .eq('user_id', userId);
      
      const bIds = myBranches?.map(b => b.id) || [];
      if (bIds.length > 0) {
        const { error: backfillErr } = await supabase
          .from('flashcard_branch_cards')
          .update({ user_id: userId })
          .in('branch_id', bIds)
          .is('user_id', null);
        
        if (backfillErr) console.warn('[FlashcardBranchSvc] Backfill warning:', backfillErr.message);
      }
    } catch (e) {
      console.error('[FlashcardBranchSvc] Backfill error:', e);
    }

    // 1. Get all user cards
    const { data: userCards, error: ucError } = await supabase
      .from('user_cards')
      .select('card_id, cards!inner(subject, section_group, microtopic)')
      .eq('user_id', userId);

    if (ucError || !userCards || userCards.length === 0) return;

    // 2. Get existing mappings
    const { data: existingMappings } = await supabase
      .from('flashcard_branch_cards')
      .select('card_id')
      .in('card_id', userCards.map(uc => uc.card_id))
      .eq('user_id', userId);
    
    const mappedIds = new Set(existingMappings?.map(m => m.card_id) || []);
    const unmappedCards = userCards.filter(uc => !mappedIds.has(uc.card_id));

    // 2.5 Clean up ghost mappings (mappings that don't belong to any user_card)
    const allUserCardIds = new Set(userCards.map(uc => uc.card_id));
    const { data: allMappings } = await supabase
      .from('flashcard_branch_cards')
      .select('card_id')
      .eq('user_id', userId);
    
    const ghostIds = (allMappings || [])
      .map(m => m.card_id)
      .filter(id => !allUserCardIds.has(id));

    if (ghostIds.length > 0) {
      console.log(`[FlashcardBranchSvc] Found ${ghostIds.length} ghost mappings. Cleaning up...`);
      await supabase
        .from('flashcard_branch_cards')
        .delete()
        .in('card_id', ghostIds)
        .eq('user_id', userId);
    }

    if (unmappedCards.length === 0) {
      console.log(`[FlashcardBranchSvc] All ${userCards.length} cards already mapped.`);
      return;
    }

    console.log(`[FlashcardBranchSvc] Found ${unmappedCards.length} unmapped cards. Repairing...`);
    let repaired = 0;

    // 3. Get existing branches to minimize DB calls (optional optimization)
    // 4. Repair unmapped cards
    for (const uc of unmappedCards) {
      try {
        const card = uc.cards as any;
        const branchId = await this.ensureDefaultBranch(
          userId,
          card.subject || 'General',
          card.section_group || 'General',
          card.microtopic || 'General'
        );

        const { error: upsertErr } = await supabase.from('flashcard_branch_cards').upsert({
          user_id: userId,
          branch_id: branchId,
          card_id: uc.card_id
        }, { onConflict: 'user_id,card_id' }); // V9 constraint

        if (upsertErr) {
          if (upsertErr.message.includes('user_id')) {
            console.error(`[FlashcardBranchSvc] DATABASE OUTDATED: Please run 'supabase/hotfix-branch-userid.sql' in your SQL Editor.`);
            return; // Stop sync, it won't work without this column
          }
          console.error(`[FlashcardBranchSvc] Repair error for card ${uc.card_id}: ${upsertErr.message}`);
        } else {
          repaired++;
        }
      } catch (err) {
        console.error(`[FlashcardBranchSvc] Repair catch error for card ${uc.card_id}:`, err);
      }
    }
    console.log(`[FlashcardBranchSvc] Hierarchy sync complete. Repaired ${repaired} cards.`);
  }

  static async getTree(userId: string, options: { includeArchived?: boolean } = {}): Promise<BranchNode[]> {
    const query = supabase
      .from('flashcard_branches')
      .select('*')
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .order('sort_order', { ascending: true });

    if (!options.includeArchived) {
      query.eq('is_archived', false);
    }

    const { data: branches, error } = await query;
    if (error) throw error;

    // Fetch all mappings for these branches at once
    const branchIds = (branches ?? []).map(b => b.id);
    const branchToCards: Record<string, Set<string>> = {};

    if (branchIds.length > 0) {
      const { data: mappings } = await supabase
        .from('flashcard_branch_cards')
        .select('branch_id, card_id, cards!inner(id)')
        .in('branch_id', branchIds)
        .eq('user_id', userId);

      mappings?.forEach(m => {
        if (!branchToCards[m.branch_id]) branchToCards[m.branch_id] = new Set();
        branchToCards[m.branch_id].add(m.card_id);
      });
    }

    // Build the tree with unique card counts
    const buildTree = (parentId: string | null = null, level = 0): BranchNode[] => {
      return (branches ?? [])
        .filter(b => b.parent_id === parentId)
        .map(b => {
          const children = buildTree(b.id, level + 1);
          
          // Get all unique card IDs for this branch and its descendants
          const uniqueIds = new Set(branchToCards[b.id] || []);
          const gatherIds = (nodes: BranchNode[]) => {
            nodes.forEach(n => {
              // We need to re-fetch the specific IDs for this child to be accurate
              // but as an optimization, we can pass them up.
              // For simplicity, we'll just track all IDs in the node object.
            });
          };

          // Actually, let's just use a more efficient way: 
          // Each node will return its set of unique IDs.
          return {
            ...b,
            level,
            children,
            // We'll compute the count by collecting all child IDs
            _allCardIds: combineIds(b.id, children)
          };
        });
    };

    const combineIds = (branchId: string, children: any[]): Set<string> => {
      const s = new Set(branchToCards[branchId] || []);
      children.forEach(c => {
        c._allCardIds.forEach((id: string) => s.add(id));
      });
      return s;
    };

    const tree = buildTree(null);
    
    // Final pass to set cardCount and remove the temporary _allCardIds
    const finalize = (nodes: any[]) => {
      nodes.forEach(n => {
        n.cardCount = n._allCardIds.size;
        delete n._allCardIds;
        finalize(n.children);
      });
    };
    finalize(tree);

    return tree;
  }

  static async createBranch(userId: string, name: string, parentId: string | null = null) {
    const { data, error } = await supabase
      .from('flashcard_branches')
      .insert({ user_id: userId, name, parent_id: parentId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  static async updateBranch(userId: string, id: string, patch: Partial<BranchNode>) {
    const { error } = await supabase
      .from('flashcard_branches')
      .update(patch)
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
  }

  static async deleteBranch(userId: string, id: string) {
    // Soft delete
    const { error } = await supabase
      .from('flashcard_branches')
      .update({ is_deleted: true })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
  }

  static async moveBranch(userId: string, id: string, newParentId: string | null) {
    const { error } = await supabase
      .from('flashcard_branches')
      .update({ parent_id: newParentId })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
  }

  static async getCardsRecursive(userId: string, branchId: string): Promise<string[]> {
    // Get this branch + all descendants
    const { data: branches } = await supabase
      .from('flashcard_branches')
      .select('id, parent_id')
      .eq('user_id', userId)
      .eq('is_deleted', false);
    
    if (!branches) return [];

    const ids = [branchId];
    const findChildren = (pid: string) => {
      branches.filter(b => b.parent_id === pid).forEach(b => {
        ids.push(b.id);
        findChildren(b.id);
      });
    };
    findChildren(branchId);

    // Only return cards that actually exist in the user's collection
    const { data: mappings } = await supabase
      .from('flashcard_branch_cards')
      .select('card_id, cards!inner(id)')
      .in('branch_id', ids)
      .eq('user_id', userId);
    
    return Array.from(new Set(mappings?.map(m => m.card_id) || []));
  }

  static async ensureDefaultBranch(userId: string, subject: string, section: string, microtopic: string): Promise<string> {
    const sub = subject || 'General';
    const sec = section || 'General';
    const mt = microtopic || 'General';

    // 1. Ensure Subject
    const { data: subBranch } = await supabase
      .from('flashcard_branches')
      .select('id')
      .eq('user_id', userId)
      .eq('name', sub)
      .is('parent_id', null)
      .maybeSingle();
    
    let subId = subBranch?.id;
    if (!subId) {
      const { data: newSub } = await supabase
        .from('flashcard_branches')
        .insert({ user_id: userId, name: sub, parent_id: null })
        .select('id')
        .single();
      subId = newSub?.id;
    }

    // 2. Ensure Section
    const { data: secBranch } = await supabase
      .from('flashcard_branches')
      .select('id')
      .eq('user_id', userId)
      .eq('name', sec)
      .eq('parent_id', subId)
      .maybeSingle();
    
    let secId = secBranch?.id;
    if (!secId) {
      const { data: newSec } = await supabase
        .from('flashcard_branches')
        .insert({ user_id: userId, name: sec, parent_id: subId })
        .select('id')
        .single();
      secId = newSec?.id;
    }

    // 3. Ensure Microtopic
    const { data: mtBranch } = await supabase
      .from('flashcard_branches')
      .select('id')
      .eq('user_id', userId)
      .eq('name', mt)
      .eq('parent_id', secId)
      .maybeSingle();
    
    let mtId = mtBranch?.id;
    if (!mtId) {
      const { data: newMt } = await supabase
        .from('flashcard_branches')
        .insert({ user_id: userId, name: mt, parent_id: secId })
        .select('id')
        .single();
      mtId = newMt?.id;
    }

    return mtId!;
  }
}
