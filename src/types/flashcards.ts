export enum CardStatus {
  ACTIVE = 'active',
  FROZEN = 'frozen',
  DELETED = 'deleted',
}

export enum LearningStatus {
  NOT_STUDIED = 'not_studied',
  LEARNING = 'learning',
  REVIEW = 'review',
  MASTERED = 'mastered',
  LEECH = 'leech',
}

export interface FlashcardBranch {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  is_archived: boolean;
  is_deleted: boolean;
  sort_order: number;
}
