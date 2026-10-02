/** Every non-2xx answer from the API, with the server's own reason. */
export class CcnodesApiError extends Error {
  readonly name = "CcnodesApiError";
  constructor(
    /** HTTP status. */
    readonly status: number,
    message: string,
    /** The parsed response body, when it was JSON. */
    readonly body?: unknown,
    /** Method and path that failed, e.g. `GET /bitcoin/richlist`. */
    readonly request?: string,
  ) {
    super(message);
  }

  /**
   * The chain's index is still being built (rich list, rank, holders). This is
   * an expected state on a newly added chain, not an outage: the server answers
   * `503 {"state":"building"}` until its own UTXO-set scan has finished and
   * been verified against the node.
   */
  get isBuilding(): boolean {
    return this.status === 503 && (this.body as { state?: string } | undefined)?.state === "building";
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/** Every attempt failed before any HTTP answer arrived. */
export class CcnodesNetworkError extends Error {
  readonly name = "CcnodesNetworkError";
  constructor(message: string, readonly cause?: unknown) {
    super(message);
  }
}
