export function StateNotice({ loading, error }) {
  if (loading) {
    return (
      <div className="state-card">
        <span className="state-dot loading" />
        <div>
          <strong>Panel sync in progress</strong>
          <p>Fetching the latest Astra Fleet panel data from the backend.</p>
        </div>
      </div>
    );
  }

  if (!error) return null;

  return (
    <div className="state-card error">
      <span className="state-dot error" />
      <div>
        <strong>Data fetch issue</strong>
        <p>{error}</p>
      </div>
    </div>
  );
}
