/** Subset of the Codeforces API objects that CF+ uses. */

export type ParticipantType = 'CONTESTANT' | 'PRACTICE' | 'VIRTUAL' | 'MANAGER' | 'OUT_OF_COMPETITION';

export interface Problem {
  contestId?: number;
  problemsetName?: string;
  index: string;
  name: string;
  rating?: number;
  tags: string[];
}

/** A submission trimmed to the fields CF+ stores (keeps the cache small). */
export interface Submission {
  id: number;
  contestId?: number;
  creationTimeSeconds: number;
  problem: Problem;
  participantType: ParticipantType;
  programmingLanguage: string;
  verdict?: string;
}

export interface RatingChange {
  contestId: number;
  contestName: string;
  rank: number;
  ratingUpdateTimeSeconds: number;
  oldRating: number;
  newRating: number;
}

export interface UserInfo {
  handle: string;
  rating?: number;
  maxRating?: number;
  rank?: string;
  maxRank?: string;
  avatar?: string;
  titlePhoto?: string;
  firstName?: string;
  lastName?: string;
  country?: string;
  city?: string;
  organization?: string;
  contribution?: number;
  friendOfCount?: number;
  registrationTimeSeconds?: number;
  lastOnlineTimeSeconds?: number;
}

export interface Contest {
  id: number;
  name: string;
  type: string;
  phase: 'BEFORE' | 'CODING' | 'PENDING_SYSTEM_TEST' | 'SYSTEM_TEST' | 'FINISHED';
  durationSeconds: number;
  startTimeSeconds?: number;
}

export interface ProblemsetProblem extends Problem {
  /** From problemset.problems → problemStatistics. */
  solvedCount?: number;
}

/** Everything the profile page needs for one handle. */
export interface UserBundle {
  handle: string;
  info: UserInfo | null;
  submissions: Submission[];
  ratingHistory: RatingChange[];
  /** Epoch ms of the last successful refresh. */
  fetchedAt: number;
}
