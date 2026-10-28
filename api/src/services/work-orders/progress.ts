export type ProgressWaiting = "you" | "builder" | "system" | "dao" | null;

export type ProgressStepState = "done" | "current" | "blocked" | "upcoming";

export type ProgressStepKey =
  | "draft"
  | "agency_signs"
  | "builder_signs"
  | "active"
  | "request"
  | "approved"
  | "paid"
  | "wrap_up";

export type ProgressAction =
  | { kind: "offer"; label: string }
  | { kind: "activate"; label: string }
  | { kind: "link"; label: string; href: string; external: boolean }
  | { kind: "approve"; label: string; requestId: string }
  | { kind: "pay"; label: string; requestId: string }
  | { kind: "renewal"; label: string }
  | { kind: "edit"; label: string };

export type ProgressStep = {
  key: ProgressStepKey;
  label: string;
  state: ProgressStepState;
  at: string | null;
  detail: string | null;
};

export type ProgressAttention = {
  key: string;
  message: string;
  action: ProgressAction | null;
};

export type Progress = {
  stage: ProgressStepKey;
  waitingOn: ProgressWaiting;
  needsYou: boolean;
  headline: string;
  since: string | null;
  next: ProgressAction | null;
  steps: ProgressStep[];
  attention: ProgressAttention[];
};

export type ProgressRequest = {
  id: string;
  code: string;
  status:
    | "draft"
    | "submitted"
    | "approved"
    | "paying"
    | "proposed"
    | "paid"
    | "rejected"
    | "failed";
  requested: string;
  approved: string | null;
  note: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  paidAt: string | null;
  blockedReason: string | null;
  blockedCode: string | null;
  daoPaymentStarted: boolean;
  createdAt: string;
};

export type ProgressInput = {
  status: "draft" | "offered" | "accepted" | "active" | "ended" | "exhausted" | "terminated";
  builderName: string;
  representativeName: string | null;
  createdAt: string;
  offeredAt: string | null;
  acceptedAt: string | null;
  activatedAt: string | null;
  updatedAt: string;
  periodStart: string;
  periodEnd: string;
  today: string;
  signFirst: boolean;
  builderSignedAt: string | null;
  representativeSignedAt: string | null;
  awaitingRepresentative: boolean;
  needsCountersign: boolean;
  representativeUrl: string | null;
  esignError: string | null;
  blockers: string[];
  payeeNeedsConfirmation: boolean;
  documentWarning: string | null;
  driveError: string | null;
  renewalStatus: "renewed" | "needs_approval" | "declined" | null;
  requests: ProgressRequest[];
};

const SETTINGS_PAYOUTS = "/admin/settings#payouts";
const FUNDING_CODES = new Set(["insufficient_balance", "over_monthly_budget", "over_cap"]);

function latestRequest(requests: ProgressRequest[]): ProgressRequest | null {
  const open = requests.filter((r) => r.status !== "rejected" && r.status !== "failed");
  const pool = open.length > 0 ? open : requests;
  return pool.reduce<ProgressRequest | null>(
    (latest, r) => (!latest || r.createdAt > latest.createdAt ? r : latest),
    null,
  );
}

function payoutFix(request: ProgressRequest): ProgressAction {
  return {
    kind: "link",
    label:
      request.blockedCode === "insufficient_balance"
        ? "Fund the agent"
        : "Open the payout settings",
    href: SETTINGS_PAYOUTS,
    external: false,
  };
}

export function progressOf(input: ProgressInput): Progress {
  const builder = input.builderName;
  const you = input.representativeName;
  const request = latestRequest(input.requests);
  const signFirst = input.signFirst;
  const started = ["active", "ended", "exhausted"].includes(input.status);
  const signed =
    started ||
    (input.builderSignedAt !== null && input.representativeSignedAt !== null) ||
    (input.status === "accepted" && !input.needsCountersign);

  let stage: ProgressStepKey = "draft";
  let waitingOn: ProgressWaiting = null;
  let headline = "";
  let since: string | null = null;
  let next: ProgressAction | null = null;

  const countersign: ProgressAction | null = input.representativeUrl
    ? {
        kind: "link",
        label: you ? `Sign as ${you}` : "Sign in Documenso",
        href: input.representativeUrl,
        external: true,
      }
    : null;

  if (input.status === "terminated") {
    stage = "wrap_up";
    headline = "Terminated: nothing more is paid under it";
    since = input.updatedAt;
  } else if (input.status === "draft") {
    stage = "draft";
    waitingOn = "you";
    headline = `Draft: review the terms, then offer it to ${builder}`;
    since = input.createdAt;
    next = { kind: "offer", label: signFirst ? "Offer and sign" : "Offer to the builder" };
  } else if (input.status === "offered" && input.awaitingRepresentative) {
    stage = "agency_signs";
    waitingOn = "you";
    headline = `Sign it to send it to ${builder}`;
    since = input.offeredAt;
    next = countersign;
  } else if (input.status === "offered") {
    stage = "builder_signs";
    waitingOn = "builder";
    headline = signFirst
      ? `Waiting for ${builder} to sign. It becomes active as soon as they do`
      : `Waiting for ${builder} to accept the terms`;
    since = input.representativeSignedAt ?? input.offeredAt;
  } else if (input.status === "accepted" && input.needsCountersign) {
    stage = "agency_signs";
    waitingOn = "you";
    headline = `${builder} signed: countersign to finish`;
    since = input.builderSignedAt ?? input.acceptedAt;
    next = countersign;
  } else if (input.status === "accepted") {
    stage = "active";
    if (input.blockers.length > 0) {
      waitingOn = "you";
      headline = input.blockers[0] ?? "Something is missing before it can start";
      next = { kind: "edit", label: "Fix it" };
    } else if (input.periodStart > input.today) {
      waitingOn = "system";
      headline = `Signed. It starts automatically on ${input.periodStart}`;
    } else {
      waitingOn = "you";
      headline = "Signed and ready to start";
      next = { kind: "activate", label: "Activate" };
    }
    since = input.acceptedAt;
  } else if (request && request.status === "submitted") {
    stage = "approved";
    waitingOn = "you";
    headline = `Approve ${request.requested} for ${builder}`;
    since = request.submittedAt;
    next = { kind: "approve", label: "Review and approve", requestId: request.id };
  } else if (request && request.status === "approved" && request.blockedCode === "needs_review") {
    stage = "paid";
    waitingOn = "you";
    headline = `Payout of ${request.approved ?? request.requested} needs a check before it's paid again`;
    since = request.decidedAt;
    next = {
      kind: "link",
      label: "Check the payout agent's history",
      href: SETTINGS_PAYOUTS,
      external: false,
    };
  } else if (request && request.status === "approved" && request.blockedReason) {
    stage = "paid";
    waitingOn = "you";
    headline = FUNDING_CODES.has(request.blockedCode ?? "")
      ? `Payout of ${request.approved ?? request.requested} is on hold: fund the agent`
      : `Payout of ${request.approved ?? request.requested} is on hold`;
    since = request.decidedAt;
    next = payoutFix(request);
  } else if (request && request.status === "approved" && request.daoPaymentStarted) {
    stage = "paid";
    waitingOn = "you";
    headline = `Create or link the DAO proposal paying ${request.approved ?? request.requested}`;
    since = request.decidedAt;
    next = { kind: "pay", label: "Link the proposal", requestId: request.id };
  } else if (request && request.status === "approved") {
    stage = "paid";
    waitingOn = "you";
    headline = `Pay ${request.approved ?? request.requested} to ${builder} through a DAO proposal`;
    since = request.decidedAt;
    next = { kind: "pay", label: "Pay it", requestId: request.id };
  } else if (request && request.status === "paying") {
    stage = "paid";
    waitingOn = "system";
    headline = `Sending ${request.approved ?? request.requested} to ${builder}`;
    since = request.decidedAt;
  } else if (request && request.status === "proposed") {
    stage = "paid";
    waitingOn = "dao";
    headline = `Waiting for the DAO to approve the transfer of ${request.approved ?? request.requested}`;
    since = request.decidedAt;
  } else if (input.renewalStatus === "needs_approval") {
    stage = "wrap_up";
    waitingOn = "you";
    headline = "It missed a renewal target: decide whether it renews";
    since = input.updatedAt;
    next = { kind: "renewal", label: "Decide on renewal" };
  } else if (request && request.status === "draft") {
    stage = "request";
    waitingOn = "builder";
    headline = `Waiting for ${builder} to submit the payout request`;
    since = request.createdAt;
  } else if (input.status === "active") {
    stage = "active";
    waitingOn = "builder";
    headline =
      input.periodEnd >= input.today
        ? `Work in progress until ${input.periodEnd}. The payout request is drafted when it ends`
        : `${builder} can send the payout request for the period`;
    since = input.activatedAt;
  } else {
    stage = "wrap_up";
    headline =
      input.status === "exhausted"
        ? "Budget used: everything under it is paid"
        : input.renewalStatus === "renewed"
          ? "Finished and renewed for the next period"
          : "Finished";
    since = input.updatedAt;
  }

  const order: ProgressStepKey[] = signFirst
    ? ["draft", "agency_signs", "builder_signs", "active", "request", "approved", "paid", "wrap_up"]
    : [
        "draft",
        "builder_signs",
        "agency_signs",
        "active",
        "request",
        "approved",
        "paid",
        "wrap_up",
      ];
  const stageIndex = order.indexOf(stage);
  const terminated = input.status === "terminated";
  const paid = request?.status === "paid";
  const done = (key: ProgressStepKey): boolean => {
    switch (key) {
      case "draft":
        return input.status !== "draft";
      case "agency_signs":
        return input.representativeSignedAt !== null || signed;
      case "builder_signs":
        return input.builderSignedAt !== null || signed;
      case "active":
        return input.activatedAt !== null && (request !== null || input.status !== "active");
      case "request":
        return request !== null && request.status !== "draft";
      case "approved":
        return (
          request !== null && ["approved", "paying", "proposed", "paid"].includes(request.status)
        );
      case "paid":
        return paid;
      case "wrap_up":
        return ["ended", "exhausted"].includes(input.status) && waitingOn === null;
    }
  };
  const at = (key: ProgressStepKey): string | null => {
    switch (key) {
      case "draft":
        return input.offeredAt ?? input.createdAt;
      case "agency_signs":
        return input.representativeSignedAt;
      case "builder_signs":
        return input.builderSignedAt ?? (signFirst ? null : input.acceptedAt);
      case "active":
        return input.activatedAt;
      case "request":
        return request?.submittedAt ?? null;
      case "approved":
        return done("approved") ? (request?.decidedAt ?? null) : null;
      case "paid":
        return request?.paidAt ?? null;
      case "wrap_up":
        return done("wrap_up") ? input.updatedAt : null;
    }
  };
  const labels: Record<ProgressStepKey, string> = {
    draft: "Draft",
    agency_signs: signFirst ? "You sign" : "You countersign",
    builder_signs: signFirst ? "Builder signs" : "Builder accepts",
    active: "Active",
    request: "Payout request",
    approved: "Approved",
    paid: "Paid",
    wrap_up: input.status === "terminated" ? "Terminated" : "Ended",
  };
  const detailOf = (key: ProgressStepKey): string | null => {
    if (key === "active") return `${input.periodStart} → ${input.periodEnd}`;
    if (key === "request" && request) return `${request.code} · ${request.requested}`;
    if (key === "approved" && request?.approved) return request.approved;
    if (key === "request" && request?.status === "rejected") return "Declined";
    return null;
  };
  const steps: ProgressStep[] = order.map((key, index) => {
    let state: ProgressStepState;
    if (done(key)) state = "done";
    else if (terminated) state = "upcoming";
    else if (index === stageIndex)
      state = key === "paid" && request?.blockedReason ? "blocked" : "current";
    else state = "upcoming";
    return {
      key,
      label: labels[key],
      state,
      at: state === "done" ? at(key) : null,
      detail: detailOf(key),
    };
  });

  const attention: ProgressAttention[] = [];
  if (input.esignError) {
    attention.push({ key: "esign", message: input.esignError, action: null });
  }
  if (input.status === "accepted") {
    for (const [index, blocker] of input.blockers.entries()) {
      if (index === 0 && headline === blocker) continue;
      attention.push({
        key: `blocker-${index}`,
        message: blocker,
        action: { kind: "edit", label: "Fix it" },
      });
    }
  }
  if (input.payeeNeedsConfirmation && !terminated && input.status !== "draft") {
    attention.push({
      key: "payee",
      message: `${builder} hasn't confirmed their payout account yet`,
      action: null,
    });
  }
  if (input.documentWarning) {
    attention.push({ key: "document", message: input.documentWarning, action: null });
  }
  if (input.driveError) {
    attention.push({
      key: "drive",
      message: `The signed PDF isn't in Google Drive yet: ${input.driveError}`,
      action: null,
    });
  }
  const failed = input.requests.find((r) => r.status === "failed");
  if (failed && failed === latestRequest(input.requests)) {
    attention.push({
      key: "failed",
      message: `${failed.code} failed: ${failed.note ?? "nothing was paid"}`,
      action: null,
    });
  }

  return {
    stage,
    waitingOn,
    needsYou: waitingOn === "you",
    headline,
    since,
    next,
    steps,
    attention,
  };
}
