import { useEffect, useRef, useState, type FormEvent } from "react";
import { ImagePlus, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  deleteProductSafely,
  listCategories,
  saveProduct,
  uploadProductImage,
} from "../../services/commerce";
import type { Product } from "../../types/commerce";

type ImageKey = "front" | "back" | "side" | "overlay";
type ImageFiles = Record<ImageKey, File | null>;

const emptyFiles: ImageFiles = { front: null, back: null, side: null, overlay: null };

export function ProductManager({
  products,
  initialCreate = false,
  onRefresh,
}: {
  products: Product[];
  initialCreate?: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Product | null>(initialCreate ? ({} as Product) : null);
  const [categories, setCategories] = useState<string[]>([]);
  const [files, setFiles] = useState<ImageFiles>(emptyFiles);
  const [filePreviews, setFilePreviews] = useState<Partial<Record<ImageKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const draftKey = editing
    ? editing.id
      ? `diane:admin:product-draft:edit:${editing.id}`
      : "diane:admin:product-draft:new"
    : null;

  // Restore an unfinished product form from this browser/app installation.
  // File inputs are intentionally excluded because browsers do not allow
  // restoring a user's local file selection after a reload.
  useEffect(() => {
    if (!draftKey) return;
    const form = formRef.current;
    if (!form) return;

    try {
      const rawDraft = window.localStorage.getItem(draftKey);
      if (!rawDraft) return;
      const draft = JSON.parse(rawDraft) as {
        version?: number;
        fields?: Record<string, string | boolean>;
      };
      if (draft.version !== 1 || !draft.fields) return;

      for (const [name, value] of Object.entries(draft.fields)) {
        const field = form.elements.namedItem(name);
        if (field instanceof HTMLInputElement && field.type === "checkbox") {
          field.checked = Boolean(value);
        } else if (
          field instanceof HTMLInputElement ||
          field instanceof HTMLTextAreaElement ||
          field instanceof HTMLSelectElement
        ) {
          field.value = String(value);
        }
      }
      setMessage("Unsaved draft restored. Your changes are saved automatically on this device.");
    } catch {
      // Ignore an invalid or unavailable draft; the normal form remains usable.
    }
  }, [draftKey]);

  const saveDraft = () => {
    if (!draftKey || !formRef.current) return;
    try {
      const fields: Record<string, string | boolean> = {};
      for (const element of Array.from(formRef.current.elements)) {
        if (
          !(element instanceof HTMLInputElement) &&
          !(element instanceof HTMLTextAreaElement) &&
          !(element instanceof HTMLSelectElement)
        ) {
          continue;
        }
        if (!element.name || (element instanceof HTMLInputElement && element.type === "file")) {
          continue;
        }
        fields[element.name] =
          element instanceof HTMLInputElement && element.type === "checkbox"
            ? element.checked
            : element.value;
      }
      window.localStorage.setItem(
        draftKey,
        JSON.stringify({ version: 1, savedAt: new Date().toISOString(), fields }),
      );
    } catch {
      setMessage("Auto-save is unavailable in this browser. Keep this form open until you save.");
    }
  };

  const discardDraft = () => {
    if (!draftKey) return;
    if (!window.confirm("Discard this unsaved product draft? This cannot be undone.")) return;
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      // The form can still be reset even if browser storage is unavailable.
    }
    formRef.current?.reset();
    setFiles(emptyFiles);
    setMessage("Unsaved draft discarded.");
  };

  useEffect(() => {
    void listCategories().then(({ data, error }) => {
      const names = (data ?? []).map((row) => String(row.name)).filter(Boolean);
      setCategories(
        names.length ? names : ["Basics", "Bottoms", "Dresses", "Knitwear", "Outerwear", "Tops"],
      );
      if (error) setMessage(`Categories could not be loaded: ${error.message}`);
    });
  }, []);

  const createNew = () => {
    setEditing({
      id: "",
      name: "",
      price: 0,
      stock: 0,
      sizes: ["S", "M", "L"],
      colors: [],
    });
    setFiles(emptyFiles);
    setMessage("");
  };

  useEffect(() => {
    if (initialCreate) createNew();
    // Open the form when Add Product navigation is selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCreate]);

  useEffect(() => {
    const next: Partial<Record<ImageKey, string>> = {};
    (Object.keys(files) as ImageKey[]).forEach((key) => {
      if (files[key]) next[key] = URL.createObjectURL(files[key]!);
    });
    setFilePreviews(next);
    return () => Object.values(next).forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing || busy) return;
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const existingImages = editing.images ?? (editing.image ? [editing.image] : []);
      const uploaded: Partial<Record<ImageKey, string>> = {};
      for (const key of ["front", "back", "side", "overlay"] as ImageKey[]) {
        if (files[key]) uploaded[key] = await uploadProductImage(files[key]!);
      }
      const front = uploaded.front || editing.image || existingImages[0];
      if (!front) throw new Error("A front product image is required.");
      // Keep the array positions stable: [front, back, side]. An empty slot
      // must not shift a side photo into the back-view position.
      const images = [
        front,
        uploaded.back || existingImages[1] || "",
        uploaded.side || existingImages[2] || "",
      ];
      const product: Product = {
        id: editing.id || `prod_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
        name: String(form.get("name")).trim(),
        description: String(form.get("description")).trim(),
        category: String(form.get("category")),
        gender: String(form.get("gender")),
        price: Number(form.get("price")),
        original_price: form.get("original_price") ? Number(form.get("original_price")) : null,
        sizes: String(form.get("sizes"))
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        colors: String(form.get("colors"))
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        material: String(form.get("material")).trim(),
        stock: Number(form.get("stock")),
        image: front,
        images,
        tryon_image: uploaded.overlay || editing.tryon_image || null,
        rating: editing.rating ?? 0,
        review_count: editing.review_count ?? 0,
        is_new: form.get("is_new") === "on",
        is_featured: form.get("is_featured") === "on",
      };
      if (
        !product.name ||
        !product.category ||
        product.price <= 0 ||
        product.stock < 0 ||
        !product.sizes?.length
      ) {
        throw new Error("Complete all required product information with valid values.");
      }
      const result = await saveProduct(product, Boolean(editing.id));
      if (result.error) throw result.error;
      if (draftKey) {
        try {
          window.localStorage.removeItem(draftKey);
        } catch {
          // Saving the product must not fail because draft cleanup failed.
        }
      }
      setMessage(editing.id ? "Product updated successfully." : "Product added successfully.");
      setEditing(null);
      setFiles(emptyFiles);
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save this product.");
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    const existing = editing.images ?? (editing.image ? [editing.image] : []);
    return (
      <section className="product-form-shell">
        <header>
          <div>
            <span className="eyebrow">DIANE INVENTORY</span>
            <h2>{editing.id ? "Edit product" : "Add product"}</h2>
          </div>
          <button className="icon-button" onClick={() => setEditing(null)}>
            <X />
          </button>
        </header>
        <form
          ref={formRef}
          className="product-admin-form"
          onSubmit={submit}
          onInput={saveDraft}
          onChange={saveDraft}
        >
          <p className="field-help">
            Your product details are saved automatically as a draft on this device. If the page
            reloads, reselect any product image files before submitting.
          </p>
          <fieldset>
            <legend>01 / PRODUCT INFORMATION</legend>
            <div className="admin-form-grid">
              <label>
                Product name
                <input name="name" defaultValue={editing.name} required />
              </label>
              <label>
                Category
                <select name="category" defaultValue={editing.category ?? ""} required>
                  <option value="">Select category</option>
                  {categories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>
              <label>
                Gender
                <select name="gender" defaultValue={editing.gender ?? "women"}>
                  <option value="women">Women</option>
                  <option value="men">Men</option>
                  <option value="unisex">Unisex</option>
                </select>
              </label>
              <label>
                Price (PHP)
                <input
                  name="price"
                  type="number"
                  min="0.01"
                  step="0.01"
                  defaultValue={editing.price || ""}
                  required
                />
              </label>
              <label>
                Original price
                <input
                  name="original_price"
                  type="number"
                  min="0.01"
                  step="0.01"
                  defaultValue={editing.original_price ?? ""}
                />
              </label>
              <label>
                Stock
                <input
                  name="stock"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={editing.stock}
                  required
                />
              </label>
              <label>
                Sizes
                <input
                  name="sizes"
                  defaultValue={(editing.sizes ?? []).join(", ")}
                  placeholder="XS, S, M, L"
                  required
                />
              </label>
              <label>
                Colors
                <input
                  name="colors"
                  defaultValue={
                    Array.isArray(editing.colors)
                      ? editing.colors.join(", ")
                      : (editing.colors ?? "")
                  }
                  placeholder="Black, White, Beige"
                />
              </label>
              <label>
                Material
                <input name="material" defaultValue={editing.material ?? ""} />
              </label>
            </div>
            <label>
              Description
              <textarea name="description" defaultValue={editing.description ?? ""} />
            </label>
          </fieldset>
          <fieldset>
            <legend>02 / INDIVIDUAL PRODUCT IMAGES</legend>
            <p className="field-help">
              Front, back, and side are separate files. Missing optional views remain unavailable;
              they are never duplicated.
            </p>
            <div className="image-upload-grid">
              {(["front", "back", "side", "overlay"] as ImageKey[]).map((key, index) => {
                const existingUrl = key === "overlay" ? editing.tryon_image : existing[index];
                const preview = filePreviews[key] || existingUrl;
                return (
                  <label className="image-upload" key={key}>
                    <span>
                      {key === "overlay" ? "TRY-ON OVERLAY" : `${key.toUpperCase()} IMAGE`}
                      {key === "front" ? " *" : ""}
                    </span>
                    <div>
                      {preview ? (
                        <img src={preview} alt={`${key} preview`} />
                      ) : (
                        <>
                          <ImagePlus />
                          <small>No image selected</small>
                        </>
                      )}
                    </div>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) =>
                        setFiles((current) => ({
                          ...current,
                          [key]: event.target.files?.[0] ?? null,
                        }))
                      }
                    />
                    {files[key] && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          setFiles((current) => ({ ...current, [key]: null }));
                        }}
                      >
                        <X size={13} /> Clear selection
                      </button>
                    )}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <fieldset className="product-flags">
            <legend>03 / DISPLAY</legend>
            <label>
              <input name="is_new" type="checkbox" defaultChecked={Boolean(editing.is_new)} /> New
              arrival
            </label>
            <label>
              <input
                name="is_featured"
                type="checkbox"
                defaultChecked={Boolean(editing.is_featured)}
              />{" "}
              Featured product
            </label>
          </fieldset>
          {message && <div className="form-message">{message}</div>}
          <div className="form-actions">
            <button className="button button--dark" disabled={busy}>
              {busy ? "SAVING…" : editing.id ? "SAVE CHANGES" : "ADD PRODUCT"}
            </button>
            <button
              type="button"
              className="button button--outline"
              onClick={() => setEditing(null)}
            >
              CLOSE
            </button>
            <button
              type="button"
              className="button button--outline"
              onClick={discardDraft}
            >
              DISCARD DRAFT
            </button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="admin-data-section">
      <div className="admin-section-actions">
        <div>
          <span className="eyebrow">DIANE INVENTORY</span>
          <h2>Product catalog</h2>
          <p>{products.length} products</p>
        </div>
        <button className="button button--dark" onClick={createNew}>
          <Plus size={16} /> ADD PRODUCT
        </button>
      </div>
      {message && <div className="form-message">{message}</div>}
      <div className="admin-product-grid">
        {products.map((product) => (
          <article key={product.id}>
            <img src={product.image || product.images?.[0] || "/diane/top1.png"} alt="" />
            <div>
              <span>{product.category}</span>
              <h3>{product.name}</h3>
              <strong>₱{Number(product.price).toLocaleString("en-PH")}</strong>
              <p>{product.stock} in stock</p>
            </div>
            <footer>
              <button
                onClick={() => {
                  setEditing(product);
                  setFiles(emptyFiles);
                }}
              >
                <Pencil size={14} /> Edit
              </button>
              <button
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Delete ${product.name}? Products with history will be protected.`,
                    )
                  )
                    return;
                  const result = await deleteProductSafely(product.id);
                  setMessage(result.error?.message ?? "Product deleted.");
                  if (!result.error) await onRefresh();
                }}
              >
                <Trash2 size={14} /> Delete
              </button>
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}
