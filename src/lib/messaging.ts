/** Typed request/response messages between content scripts / popup and the background worker. */
import type { ContestRatings } from './estimates-service';
import type { FriendOnProblem } from './friends';
import type { PredictRequest, PredictResponse } from './predictor-service';
import type { Contest, ProblemsetProblem, UserBundle } from './types';
import type { UserInfo } from './types';
import type { LiveContest } from './live-contest';

export interface FriendsOnProblemResponse {
  solved: FriendOnProblem[];
  tried: FriendOnProblem[];
  progress: { synced: number; total: number };
}

export type Request =
  | { type: 'profilePreview'; handle: string }
  | { type: 'liveContest'; contestId: number; handle: string }
  | { type: 'user'; handle: string; refresh: boolean }
  | { type: 'problemset'; refresh?: boolean }
  | { type: 'contests'; refresh?: boolean }
  | { type: 'clearCache' }
  | ({ type: 'predict' } & PredictRequest)
  | { type: 'problemRatings'; contestIds: number[] }
  | { type: 'friendsOnProblem'; contestId: number; index: string }
  | { type: 'friendCounts'; keys: string[] }
  | { type: 'setFriends'; handles: string[] }
  | { type: 'friendsStatus' }
  | { type: 'friendList' }
  | { type: 'syncFriends' };

export type ResponseFor<R extends Request> = R extends { type: 'profilePreview' } ? UserInfo
  : R extends { type: 'liveContest' } ? LiveContest
  : R extends { type: 'user' }
  ? UserBundle | null
  : R extends { type: 'problemset' }
    ? ProblemsetProblem[]
    : R extends { type: 'contests' }
      ? Contest[]
      : R extends { type: 'predict' }
        ? PredictResponse
        : R extends { type: 'problemRatings' }
          ? Record<number, ContestRatings>
          : R extends { type: 'friendsOnProblem' }
            ? FriendsOnProblemResponse
            : R extends { type: 'friendCounts' }
              ? Record<string, string[]>
              : R extends { type: 'friendList' }
                ? string[]
                : R extends { type: 'friendsStatus' } | { type: 'syncFriends' }
                ? { synced: number; total: number; scrapedAt: number }
                : void;

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

export async function send<R extends Request>(req: R): Promise<ResponseFor<R>> {
  const res = (await chrome.runtime.sendMessage(req)) as Envelope<ResponseFor<R>> | undefined;
  if (!res) throw new Error('CF+ background did not respond');
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export function handle<R extends Request>(
  fn: (req: R, sender: chrome.runtime.MessageSender) => Promise<unknown>,
) {
  chrome.runtime.onMessage.addListener((req: R, sender, reply) => {
    fn(req, sender).then(
      (data) => reply({ ok: true, data }),
      (e: unknown) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return true; // async reply
  });
}
