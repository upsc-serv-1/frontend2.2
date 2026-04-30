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
    console.log(`[FlashcardBranchSvc] Checking bootstrap for user: ${userId}`);
    
    // 1. Check if we have any mappings for our branches
    const { data: branches } = await supabase
      .from('flashcard_branches')
      .select('id, name, parent_id')
      .eq('user_id', userId);

    let mappingCount = 0;
    if (branches && branches.length > 0) {
      const { count } = await supabase
        .from('flashcard_branch_cards')
        .select('id', { count: 'exact', head: true })
        .in('branch_id', branches.map(b => b.id));
      mappingCount = count || 0;
    }
    
    const existingBranches = branches || [];

    if (mappingCount !== 0 && existingBranches.length > 0) {
      console.log(`[FlashcardBranchSvc] Bootstrap skipped: already has ${mappingCount} mappings.`);
      return;
    }

    // 2. Fetch all cards for this user
    const { data: userCards, error: ucError } = await supabase
      .from('user_cards')
      .select('card_id, cards!inner(subject, section_group, microtopic)')
      .eq('user_id', userId);

    if (ucError || !userCards || userCards.length === 0) {
      console.log(`[FlashcardBranchSvc] No cards to bootstrap.`);
      return;
    }

    console.log(`[FlashcardBranchSvc] Bootstrapping ${userCards.length} cards...`);

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

    // Helper to find or create branch
    const findOrCreate = async (name: string, pId: string | null): Promise<string> => {
      const existing = existingBranches?.find(b => b.name === name && b.parent_id === pId);
      if (existing) return existing.id;

      const { data, error } = await supabase
        .from('flashcard_branches')
        .insert({ user_id: userId, name, parent_id: pId })
        .select('id')
        .single();
      if (error) throw error;
      return data.id;
    };

    // 4. Create branches and mappings
    for (const [subName, sections] of Object.entries(subjects)) {
      try {
        const subId = await findOrCreate(subName, null);

        for (const [secName, microtopics] of Object.entries(sections as any)) {
          const secId = await findOrCreate(secName, subId);

          for (const [microName, cardIds] of Object.entries(microtopics as any)) {
            const mtId = await findOrCreate(microName, secId);

            // Map cards using upsert to avoid duplicates
            const mappings = (cardIds as string[]).map(cardId => ({
              branch_id: mtId,
              card_id: cardId
            }));

            // Insert in chunks of 50 to avoid payload limits
            for (let i = 0; i < mappings.length; i += 50) {
              await supabase.from('flashcard_branch_cards').upsert(mappings.slice(i, i + 50));
            }
          }
        }
      } catch (err) {
        console.error(`[FlashcardBranchSvc] Bootstrap error for subject ${subName}:`, err);
      }
    }
    console.log(`[FlashcardBranchSvc] Bootstrap complete.`);
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

    // Fetch card counts for branches
    const branchIds = (branches ?? []).map(b => b.id);
    const countsMap: Record<string, number> = {};

    if (branchIds.length > 0) {
      const { data: cardCounts } = await supabase
        .from('flashcard_branch_cards')
        .select('branch_id')
        .in('branch_id', branchIds);

      cardCounts?.forEach(c => {
        countsMap[c.branch_id] = (countsMap[c.branch_id] || 0) + 1;
      });
    }

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
