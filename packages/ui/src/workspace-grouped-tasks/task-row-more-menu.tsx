import type { ReactNode } from "react";
import { Ellipsis } from "@/components/icons/tabler.js";
import { Button } from "@/components/ui/button.js";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu.js";

export function TaskRowMoreMenu({
  label,
  children,
  open,
  onOpenChange,
}: {
  label: string;
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <span
      className="inline-flex shrink-0"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className="size-6 rounded-md"
          >
            <Ellipsis className="size-3" strokeWidth={1.5} />
          </Button>
        </DropdownMenuTrigger>
        {open ? children : null}
      </DropdownMenu>
    </span>
  );
}
