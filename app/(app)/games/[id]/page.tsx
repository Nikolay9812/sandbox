export default async function Page({ params }: PageProps<"/games/[id]">) {
  const { id } = await params

  return <p>{id}</p>
}
