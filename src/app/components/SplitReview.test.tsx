// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SplitReview } from "./SplitReview";

describe("SplitReview", () => {
  it("shows the request count and highlights large batches", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ prompt: `prompt ${i}` }));
    render(<SplitReview items={items} onChange={() => {}} onConfirm={() => {}} onCancel={() => {}} />);
    const count = screen.getByTestId("request-count");
    expect(count.textContent).toContain("12");
    expect(count.className).toContain("text-red");
  });

  it("does not highlight small batches", () => {
    render(
      <SplitReview
        items={[{ prompt: "a" }, { prompt: "b" }]}
        onChange={() => {}}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByTestId("request-count").className).not.toContain("text-red");
  });

  it("removes a row", () => {
    const onChange = vi.fn();
    render(
      <SplitReview
        items={[{ prompt: "a" }, { prompt: "b" }]}
        onChange={onChange}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getAllByLabelText("Remove prompt")[0]);
    expect(onChange).toHaveBeenCalledWith([{ prompt: "b" }]);
  });

  it("confirms with the current prompts", () => {
    const onConfirm = vi.fn();
    render(
      <SplitReview
        items={[{ prompt: "a" }, { prompt: "b" }]}
        onChange={() => {}}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByText(/Generate 2/));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("disables generation and shows progress while busy", () => {
    const onConfirm = vi.fn();
    render(
      <SplitReview
        items={[{ prompt: "a" }, { prompt: "b" }]}
        onChange={() => {}}
        onConfirm={onConfirm}
        onCancel={() => {}}
        busy
      />,
    );
    const button = screen.getByText("Generating…").closest("button")!;
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows the requested output path in the output name field", () => {
    render(
      <SplitReview
        items={[{ prompt: "a villa", path: "public/images/villa/01.jpg" }]}
        onChange={() => {}}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const input = screen.getByLabelText("Output name 1") as HTMLInputElement;
    expect(input.value).toBe("public/images/villa/01.jpg");
  });

  it("leaves the output name field empty when an item has no path", () => {
    render(
      <SplitReview
        items={[{ prompt: "a cat" }]}
        onChange={() => {}}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const input = screen.getByLabelText("Output name 1") as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("edits the output name for the right row", () => {
    const onChange = vi.fn();
    render(
      <SplitReview
        items={[{ prompt: "a cat" }, { prompt: "a dog" }]}
        onChange={onChange}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Output name 2"), { target: { value: "dog/01.jpg" } });
    expect(onChange).toHaveBeenCalledWith([{ prompt: "a cat" }, { prompt: "a dog", path: "dog/01.jpg" }]);
  });

  it("clearing the output name field removes the path", () => {
    const onChange = vi.fn();
    render(
      <SplitReview
        items={[{ prompt: "a villa", path: "villa/01.jpg" }]}
        onChange={onChange}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Output name 1"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith([{ prompt: "a villa", path: undefined }]);
  });

  it("shows the shared style suffix once, not per row", () => {
    render(
      <SplitReview
        items={[
          { prompt: "a villa", suffix: "Photorealistic, 8k" },
          { prompt: "a pool", suffix: "Photorealistic, 8k" },
        ]}
        onChange={() => {}}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const input = screen.getByLabelText(/Style suffix/) as HTMLInputElement;
    expect(input.value).toBe("Photorealistic, 8k");
    expect(screen.getAllByDisplayValue("Photorealistic, 8k")).toHaveLength(1);
  });

  it("leaves the shared suffix field empty when no item has one", () => {
    render(
      <SplitReview
        items={[{ prompt: "a cat" }]}
        onChange={() => {}}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect((screen.getByLabelText(/Style suffix/) as HTMLInputElement).value).toBe("");
  });

  it("editing the shared suffix applies it to every row", () => {
    const onChange = vi.fn();
    render(
      <SplitReview
        items={[{ prompt: "a cat" }, { prompt: "a dog" }]}
        onChange={onChange}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Style suffix/), { target: { value: "8k, ultra-detailed" } });
    expect(onChange).toHaveBeenCalledWith([
      { prompt: "a cat", suffix: "8k, ultra-detailed" },
      { prompt: "a dog", suffix: "8k, ultra-detailed" },
    ]);
  });

  it("clearing the shared suffix field removes it from every row", () => {
    const onChange = vi.fn();
    render(
      <SplitReview
        items={[
          { prompt: "a villa", suffix: "8k" },
          { prompt: "a pool", suffix: "8k" },
        ]}
        onChange={onChange}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Style suffix/), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith([
      { prompt: "a villa", suffix: undefined },
      { prompt: "a pool", suffix: undefined },
    ]);
  });

  it("clicking the clear-suffix trash icon removes the suffix from every row", () => {
    const onChange = vi.fn();
    render(
      <SplitReview
        items={[
          { prompt: "a villa", suffix: "8k" },
          { prompt: "a pool", suffix: "8k" },
        ]}
        onChange={onChange}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Clear style suffix"));
    expect(onChange).toHaveBeenCalledWith([
      { prompt: "a villa", suffix: undefined },
      { prompt: "a pool", suffix: undefined },
    ]);
  });

  it("a newly added row inherits the current shared suffix", () => {
    const onChange = vi.fn();
    render(
      <SplitReview
        items={[{ prompt: "a villa", suffix: "8k" }]}
        onChange={onChange}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("Add prompt"));
    expect(onChange).toHaveBeenCalledWith([
      { prompt: "a villa", suffix: "8k" },
      { prompt: "", suffix: "8k" },
    ]);
  });
});
