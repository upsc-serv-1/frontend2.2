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
  static async bootstrapIfEmpty(userId: string) {
    // 1. Check if branches exist
    const { count } = await supabase
      .from('flashcard_branches')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (count !== 0) return;

    // 2. Fetch all cards for this user
    const { data: userCards, error: ucError } = await supabase
      .from('user_cards')
      .select('card_id, cards!inner(subject, section_group, microtopic)')
      .eq('user_id', userId);

    if (ucError || !userCards || userCards.length === 0) return;

    // 3. Build hierarchy map from existing card fields
    const subjects: Record<string, any> = {};
    
    userCards.forEach(uc => {
      const card = uc.cards as any;
      const sub = card.subject || 'General';
      const sec = card.section_group || 'General';
      const micro = card.microtopic || 'General';

      if (!subjects[sub]) subjects[sub] = {};
      if (!subjects[sub][sec]) subjects[sub][sec] = {};
      if (!subjects[sub][sec][micro]) subjects[sub][sec][micro] = [];
      
      subjects[sub][sec][micro].push(uc.card_id);
    });

    // 4. Create branches and mappings
    for (const [subName, sections] of Object.entries(subjects)) {
      // Create Subject branch
      const { data: subBranch } = await supabase
        .from('flashcard_branches')
        .insert({ user_id: userId, name: subName, parent_id: null })
        .select()
        .single();

      if (!subBranch) continue;

      for (const [secName, microtopics] of Object.entries(sections as any)) {
        // Create Section branch
        const { data: secBranch } = await supabase
          .from('flashcard_branches')
          .insert({ user_id: userId, name: secName, parent_id: subBranch.id })
          .select()
          .single();

        if (!secBranch) continue;

        for (const [microName, cardIds] of Object.entries(microtopics as any)) {
          // Create Microtopic branch
          const { data: microBranch } = await supabase
            .from('flashcard_branches')
            .insert({ user_id: userId, name: microName, parent_id: secBranch.id })
            .select()
            .single();

          if (!microBranch) continue;

          // Map cards
          const mappings = (cardIds as string[]).map(cardId => ({
            user_id: userId,
            branch_id: microBranch.id,
            card_id: cardId
          }));

          await supabase.from('flashcard_branch_cards').insert(mappings);
        }
      }
    }
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

    // Fetch card counts for leaf branches (or all branches for aggregation)
    const { data: cardCounts } = await supabase
      .from('flashcard_branch_cards')
      .select('branch_id, card_id')
      .eq('user_id', userId);

    const countsMap: Record<string, number> = {};
    cardCounts?.forEach(c => {
      countsMap[c.branch_id] = (countsMap[c.branch_id] || 0) + 1;
    });

    // Build the tree
    const buildTree = (parentId: string | null = null, level = 0): BranchNode[] => {
      return (branches ?? [])
        .filter(b => b.parent_id === parentId)
        .map(b => {
          const children = buildTree(b.id, level + 1);
          const leafCount = countsMap[b.id] || 0;
          const totalCount = leafCount + children.reduce((acc, c) => acc + (c.cardCount || 0), 0);
          
          return {
            ...b,
            level,
            children,
            cardCount: totalCount
          };
        });
    };

    return buildTree(null);
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

    const { data: mappings } = await supabase
      .from('flashcard_branch_cards')
      .select('card_id')
      .in('branch_id', ids);
    
    return Array.from(new Set(mappings?.map(m => m.card_id) || []));
  }
}
