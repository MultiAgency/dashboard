import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { type ColumnDef, DataTable } from "../src/components/ui/data-table";

afterEach(cleanup);

type Row = { name: string };

const columns: ColumnDef<Row, unknown>[] = [{ accessorKey: "name", header: "Name" }];
const data: Row[] = [{ name: "beta" }, { name: "alpha" }, { name: "gamma" }];

function cellTexts() {
  return Array.from(document.querySelectorAll("tbody td")).map((td) => td.textContent);
}

describe("DataTable header", () => {
  test("renders no header cell inside another header cell", () => {
    render(<DataTable columns={columns} data={data} />);
    expect(document.querySelectorAll("th th")).toHaveLength(0);
    expect(document.querySelectorAll("thead th")).toHaveLength(1);
  });

  test("the sort control toggles the order and the header reports it", () => {
    render(<DataTable columns={columns} data={data} />);
    const header = screen.getByRole("columnheader", { name: "Name" });
    expect(header.getAttribute("aria-sort")).toBe("none");
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(header.getAttribute("aria-sort")).toBe("ascending");
    expect(cellTexts()).toEqual(["alpha", "beta", "gamma"]);
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(header.getAttribute("aria-sort")).toBe("descending");
    expect(cellTexts()).toEqual(["gamma", "beta", "alpha"]);
  });
});
