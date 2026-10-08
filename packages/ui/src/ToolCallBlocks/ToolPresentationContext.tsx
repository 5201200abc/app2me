import { createContext } from "react";
export const ToolPresentationScopeContext = createContext("");
export const ToolPresentationStatusContext = createContext<string | undefined>(undefined);
export const ToolOperationListContext = createContext(false);
