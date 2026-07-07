import type { Response } from "express";

export function sendServiceResult(res: Response, result: { status: number; body: unknown }) {
  if (result.body === null) return res.status(result.status).send();
  return res.status(result.status).json(result.body);
}
