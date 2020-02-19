import { Suite } from "mocha";

export type SuiteWithContext<T> = Suite & T;
