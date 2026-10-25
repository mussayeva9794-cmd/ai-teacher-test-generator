import { ru } from "./ru";
import { kk } from "./kk";
import { en } from "./en";
import type { Locale } from "../config";

export type Dictionary = typeof ru;

export const dictionaries: Record<Locale, Dictionary> = { kk, ru, en };
