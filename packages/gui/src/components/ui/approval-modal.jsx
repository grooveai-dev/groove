// FSL-1.1-Apache-2.0 — see LICENSE
import { AnimatePresence, motion } from 'framer-motion';
import { ShieldCheck, ShieldX, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/button';
import { useGrooveStore } from '../../stores/groove';

export function ApprovalModal() {
  const pendingApprovals = useGrooveStore((s) => s.pendingApprovals);
  const approveRequest = useGrooveStore((s) => s.approveRequest);
  const rejectRequest = useGrooveStore((s) => s.rejectRequest);

  if (!pendingApprovals?.length) return null;

  return (
    <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 w-full max-w-md flex flex-col gap-2 px-4">
      <AnimatePresence>
        {pendingApprovals.map((approval) => (
          <motion.div
            key={approval.id}
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="rounded-lg border border-accent/30 bg-surface-2/95 backdrop-blur-md shadow-xl shadow-accent/5 overflow-hidden"
          >
            <div className="px-4 py-3 flex items-start gap-3">
              <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-0 font-sans truncate">
                  {approval.agentName || 'Agent'} needs approval
                </p>
                {approval.action?.description && (
                  <p className="text-2xs text-text-3 font-sans mt-0.5 line-clamp-2">
                    {approval.action.description}
                  </p>
                )}
              </div>
            </div>
            <div className="px-4 py-2.5 border-t border-border-subtle flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="text-danger hover:bg-danger/10"
                onClick={() => rejectRequest(approval.id)}
              >
                <ShieldX size={14} className="mr-1" />
                Reject
              </Button>
              <Button
                size="sm"
                variant="accent"
                onClick={() => approveRequest(approval.id)}
              >
                <ShieldCheck size={14} className="mr-1" />
                Approve
              </Button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
