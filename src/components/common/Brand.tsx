export function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? "brand--light" : ""}`} aria-label="DIANE Clothing Shop">
      <span>DIANE</span>
      <small>CLOTHING SHOP</small>
    </div>
  );
}
