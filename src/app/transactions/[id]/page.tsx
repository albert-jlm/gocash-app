import TransactionDetail from "./transaction-detail";

export function generateStaticParams() {
  return [{ id: "preview" }];
}

type Props = { params: Promise<{ id: string }> };

export default async function TransactionDetailPage({ params }: Props) {
  const { id } = await params;
  return <TransactionDetail transactionId={id} />;
}
