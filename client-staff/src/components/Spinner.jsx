export default function Spinner({ small = false }) {
  return <span className={small ? 'spinner spinner-sm' : 'spinner'} aria-hidden="true" />;
}
