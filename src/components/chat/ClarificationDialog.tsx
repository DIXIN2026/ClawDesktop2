import { useEffect, useMemo, useState } from 'react';
import { MessageCircleQuestion } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { ClarificationRequest } from '@/stores/chat';

interface ClarificationDialogProps {
  clarification: ClarificationRequest;
  onSubmit: (answers: Record<string, string>) => void;
  onSkip: () => void;
}

export function ClarificationDialog({
  clarification,
  onSubmit,
  onSkip,
}: ClarificationDialogProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    setAnswers({});
  }, [clarification.id]);

  const answeredCount = useMemo(
    () => clarification.questions.filter((q) => (answers[q] ?? '').trim().length > 0).length,
    [answers, clarification.questions],
  );

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onSkip(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircleQuestion className="h-5 w-5 text-blue-500" />
            需求澄清
          </DialogTitle>
          <DialogDescription>
            Requirements Agent 需要你补充信息。可部分回答；未填写项将按“未回答”继续。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-1">
          {clarification.questions.map((question, idx) => (
            <div key={`${clarification.id}-${idx}`} className="space-y-1.5">
              <p className="text-sm font-medium">{idx + 1}. {question}</p>
              <textarea
                value={answers[question] ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  setAnswers((prev) => ({ ...prev, [question]: value }));
                }}
                placeholder="请输入你的回答（可留空）"
                className="w-full min-h-[80px] rounded-md border bg-background px-3 py-2 text-sm resize-y"
              />
            </div>
          ))}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            已回答 {answeredCount}/{clarification.questions.length}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onSkip}>跳过</Button>
            <Button onClick={() => onSubmit(answers)}>提交回答</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
